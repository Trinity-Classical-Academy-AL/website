import { defineMiddleware } from 'astro:middleware';
import { emailOpensAdmin, getFamily, readFamilySession } from '@tca/school';
import { originOk, roleHome } from './lib/security.ts';

const OPEN = new Set(['/', '/password', '/sent', '/verify', '/setup', '/forgot', '/reset', '/reset-expired', '/google-unavailable', '/sign-out', '/interested', '/auth/google', '/auth/google/callback']);

export const onRequest = defineMiddleware(async (context, next) => {
	if (context.request.method === 'POST' && !originOk(context.request)) {
		return new Response('Cross-site request blocked.', { status: 403 });
	}
	const session = readFamilySession(context.request);
	context.locals.familyId = session.familyId;
	const family = context.locals.familyId ? await getFamily(context.locals.familyId) : null;
	context.locals.roles = family?.roles ?? [];
	context.locals.sessionEmail = session.email || family?.email || '';
	const path = context.url.pathname.replace(/\/$/, '') || '/';
	const publicTour = path === '/tour' && context.request.method === 'GET';
	if (!family && !OPEN.has(path) && !path.startsWith('/auth/') && !publicTour) return context.redirect('/');
	if (family && (path === '/' || path === '/password' || path === '/setup') && context.request.method === 'GET') {
		if (path === '/' && context.url.searchParams.get('next') === '/tour') return context.redirect('/tour');
		return context.redirect(roleHome(family.roles, context.locals.sessionEmail));
	}
	const adminSession = context.locals.roles.includes('admin') && emailOpensAdmin(context.locals.sessionEmail);
	if (path.startsWith('/admin') && !adminSession) return context.redirect('/no-access');
	if (path.startsWith('/g') && !context.locals.roles.includes('guardian')) return context.redirect('/no-access');
	return next();
});
