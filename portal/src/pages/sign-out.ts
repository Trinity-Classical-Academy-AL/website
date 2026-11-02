import type { APIRoute } from 'astro';
import { FAMILY_COOKIE } from '@tca/school';

export const prerender = false;

export const POST: APIRoute = ({ cookies, redirect }) => {
	cookies.delete(FAMILY_COOKIE, { path: '/' });
	return redirect('/');
};

export const GET: APIRoute = ({ redirect }) => redirect('/');
