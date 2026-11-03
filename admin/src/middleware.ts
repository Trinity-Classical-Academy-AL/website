import { defineMiddleware } from 'astro:middleware';
import { readStaffSession } from '@tca/school';

export const onRequest = defineMiddleware(async (context, next) => {
	context.locals.staff = readStaffSession(context.request);
	const path = context.url.pathname;
	const open = path === '/' || path === '/sign-out';
	if (!context.locals.staff && !open) return context.redirect('/');
	if (context.locals.staff && path === '/' && context.request.method === 'GET') return context.redirect('/home');
	return next();
});
