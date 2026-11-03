import type { APIRoute } from 'astro';
import { STAFF_COOKIE } from '@tca/school';

export const prerender = false;

export const POST: APIRoute = ({ cookies, redirect }) => {
	cookies.delete(STAFF_COOKIE, { path: '/' });
	return redirect('/');
};

export const GET: APIRoute = ({ redirect }) => redirect('/');
