import { defineMiddleware } from 'astro:middleware';
import { getFamily, readFamilyId } from '@tca/school';
import { originOk, roleHome } from './lib/security.ts';

const OPEN = new Set(['/', '/password', '/sent', '/verify', '/setup', '/forgot', '/reset', '/reset-expired', '/google-unavailable', '/sign-out', '/auth/google', '/auth/google/callback']);

export const onRequest = defineMiddleware(async (context, next) => {
	if (context.request.method === 'POST' && !originOk(context.request)) {
		return new Response('Cross-site request blocked.', { status: 403 });
	}
	context.locals.familyId = readFamilyId(context.request);
	const family = context.locals.familyId ? await getFamily(context.locals.familyId) : null;
	context.locals.roles = family?.roles ?? [];
	const path = context.url.pathname;
	if (!family && !OPEN.has(path) && !path.startsWith('/auth/')) return context.redirect('/');
	if (family && (path === '/' || path === '/password' || path === '/setup') && context.request.method === 'GET') {
		return context.redirect(roleHome(family.roles));
	}
	if (path.startsWith('/admin') && !context.locals.roles.includes('admin')) return context.redirect('/no-access');
	if (path.startsWith('/g') && !context.locals.roles.includes('guardian')) return context.redirect('/no-access');
	return next();
});
