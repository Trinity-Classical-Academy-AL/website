import { defineMiddleware } from 'astro:middleware';
import { emailOpensAdmin, getFamily, readFamilySession, withDatabaseTiming } from '@tca/school';
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
	context.locals.roles = family?.roles ?? [];
	context.locals.sessionEmail = session.email || family?.email || '';
	const path = context.url.pathname.replace(/\/$/, '') || '/';
	if (wantsTour(context.url.searchParams.get('next')) || ['/', '/signup', '/password', '/auth/google'].includes(path)) {
		rememberNext(context.cookies, context.url.protocol === 'https:', context.url.searchParams.get('next'));
	}
	const publicTour = path === '/tour' && context.request.method === 'GET';
	if (!family && !OPEN.has(path) && !path.startsWith('/rsvp/') && !path.startsWith('/auth/') && !publicTour) return context.redirect('/');
	if (family && (path === '/' || path === '/signup' || path === '/password' || path === '/setup') && context.request.method === 'GET') {
		return context.redirect(new URL(landingAfterAuth(context.cookies, family.roles, context.locals.sessionEmail), context.url.origin).href, 303);
	}
	const adminSession = context.locals.roles.includes('admin') && emailOpensAdmin(context.locals.sessionEmail);
	if (path.startsWith('/admin') && !adminSession) return context.redirect('/no-access');
	const guardianPath = path === '/g' || path.startsWith('/g/');
	if (guardianPath && !context.locals.roles.includes('guardian')) return context.redirect('/no-access');
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
