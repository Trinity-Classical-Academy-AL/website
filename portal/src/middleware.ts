import { defineMiddleware } from 'astro:middleware';
import { emailOpensAdmin, getFamily, readFamilySession, sessionAccess, withDatabaseTiming } from '@tca/school';
import { originOk, rememberNext, landingAfterAuth, wantsTour } from './lib/security.ts';

const OPEN = new Set(['/', '/signup', '/password', '/sent', '/verify', '/setup', '/forgot', '/reset', '/reset-expired', '/google-unavailable', '/sign-out', '/interested', '/interview', '/health', '/classreach/ingest', '/auth/google', '/auth/google/callback']);

export const onRequest = defineMiddleware((context, next) => withDatabaseTiming(async (metrics) => {
	const started = performance.now();
	const response = import.meta.env.DEV
		? await (await import('./dev/login.ts')).withDevTools(context, () => handleRequest(context, next))
		: await handleRequest(context, next);
	try {
		response.headers.append('Server-Timing', `total;dur=${(performance.now() - started).toFixed(1)}, db;dur=${metrics.duration.toFixed(1)}, queries;desc="${metrics.queries}"`);
	} catch {
		// Some responses have immutable headers (e.g. Response.redirect). Timing is best effort.
	}
	return response;
}));

const handleRequest = defineMiddleware(async (context, next) => {
	// These machine endpoints authenticate their own signatures/tokens before any DB access.
	if (['/api/ingest/formaloo', '/api/ingest/netlify-forms', '/api/ingest/digest-preview'].includes(context.url.pathname)) return next();
	if (context.request.method === 'POST' && !originOk(context.request)) {
		return new Response('Cross-site request blocked.', { status: 403 });
	}
	const session = readFamilySession(context.request);
	context.locals.familyId = session.familyId;
	const family = context.locals.familyId ? await getFamily(context.locals.familyId) : null;
	context.locals.family = family;
	// A merged family's session continues as the family it joined.
	if (family) context.locals.familyId = family.id;
	context.locals.sessionEmail = session.email || family?.email || '';
	// Access is the signed-in person's (staff, admin, developer); the family-side role
	// (prospect or guardian) comes from the household's stage, worked out from data.
	context.locals.access = family ? await sessionAccess(family.id, context.locals.sessionEmail) : null;
	if (family && context.locals.access) family.roles = context.locals.access.roles as typeof family.roles;
	context.locals.roles = (family?.roles ?? []) as typeof context.locals.roles;
	const path = context.url.pathname.replace(/\/$/, '') || '/';
	if (wantsTour(context.url.searchParams.get('next')) || ['/', '/signup', '/password', '/auth/google'].includes(path)) {
		rememberNext(context.cookies, context.url.protocol === 'https:', context.url.searchParams.get('next'));
	}
	const publicTour = path === '/tour' && context.request.method === 'GET';
	if (!family && !OPEN.has(path) && !path.startsWith('/rsvp/') && !path.startsWith('/auth/') && !publicTour) return context.redirect('/');
	// A student's own sign-in opens only their pages (/s) and signing out.
	if (context.locals.access?.studentId && !(path === '/s' || path.startsWith('/s/') || path === '/sign-out')) return context.redirect('/s');
	if ((path === '/s' || path.startsWith('/s/')) && !context.locals.access?.studentId) return context.redirect('/no-access');
	if (family && (path === '/' || path === '/signup' || path === '/password' || path === '/setup') && context.request.method === 'GET') {
		return context.redirect(new URL(landingAfterAuth(context.cookies, family.roles, context.locals.sessionEmail), context.url.origin).href, 303);
	}
	const adminSession = context.locals.roles.includes('admin') && emailOpensAdmin(context.locals.sessionEmail);
	if (path.startsWith('/admin') && !adminSession) return context.redirect('/no-access');
	const guardianPath = path === '/g' || path.startsWith('/g/');
	// A single form (/g/forms/<id>) is open to any family it's assigned to: applicants fill in their full application there.
	const singleForm = /^\/g\/forms\/[^/]+$/.test(path);
	if (guardianPath && !singleForm && !context.locals.roles.includes('guardian')) return context.redirect('/no-access');
	// Teachers use the Staff pages; admins can too (to oversee classes and release report cards).
	if ((path === '/staff' || path.startsWith('/staff/')) && !context.locals.roles.includes('staff') && !context.locals.roles.includes('admin')) return context.redirect('/no-access');
	if ((path === '/developer' || path.startsWith('/developer/')) && !context.locals.roles.includes('developer')) return context.redirect('/no-access');
	const response = await next();
	// Session pages must never enter a shared CDN cache. no-cache (not no-store) lets a tap prefetch be reused.
	if ((family || path.startsWith('/rsvp/')) && response.headers.get('content-type')?.includes('text/html')) {
		try {
			response.headers.set('Cache-Control', 'private, no-cache');
			response.headers.set('Netlify-CDN-Cache-Control', 'no-store');
		} catch {
			// Immutable headers; the platform default (no-cache) still applies.
		}
	}
	return response;
});
