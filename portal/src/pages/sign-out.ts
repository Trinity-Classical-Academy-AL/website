import type { APIRoute } from 'astro';
import { FAMILY_COOKIE } from '@tca/school';
import { csrfOk } from '../lib/security.ts';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, redirect, request }) => {
	const form = await request.formData();
	if (!csrfOk(cookies, form)) return new Response('That request expired.', { status: 403 });
	cookies.delete(FAMILY_COOKIE, { path: '/' });
	return redirect('/?signedout=1');
};

export const GET: APIRoute = ({ redirect }) => redirect('/');
