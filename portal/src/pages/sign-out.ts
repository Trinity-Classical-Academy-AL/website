import type { APIRoute } from 'astro';
import { FAMILY_COOKIE } from '@tca/school';
import { csrfOk, safeNext, rememberNext } from '../lib/security.ts';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, redirect, request }) => {
	const form = await request.formData();
	if (!csrfOk(cookies, form)) return new Response('That request expired.', { status: 403 });
	cookies.delete(FAMILY_COOKIE, { path: '/' });
	rememberNext(cookies, false, '');
	return redirect(safeNext(String(form.get('next') ?? '')) || '/?signedout=1', 303);
};

export const GET: APIRoute = ({ redirect }) => redirect('/');
