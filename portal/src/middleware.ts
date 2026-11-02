import { defineMiddleware } from 'astro:middleware';
import { readFamilyId } from '@tca/school';

const OPEN = new Set(['/', '/signup', '/verify', '/forgot', '/reset', '/sign-out']);

export const onRequest = defineMiddleware(async (context, next) => {
	context.locals.familyId = readFamilyId(context.request);
	const path = context.url.pathname;
	if (!context.locals.familyId && !OPEN.has(path)) return context.redirect('/');
	if (context.locals.familyId && (path === '/' || path === '/signup') && context.request.method === 'GET') {
		return context.redirect('/home');
	}
	return next();
});
