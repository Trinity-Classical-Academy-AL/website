import type { APIRoute } from 'astro';
import { FAMILY_COOKIE } from '@tca/school';
import { csrfOk, safeNext, rememberNext } from '../lib/security.ts';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, redirect, request, url }) => {
	const form = await request.formData();
	if (!csrfOk(cookies, form)) return new Response('That request expired.', { status: 403 });
	cookies.delete(FAMILY_COOKIE, { path: '/' });
	const next = safeNext(String(form.get('next') ?? ''));
	rememberNext(cookies, url.protocol === 'https:', next || '');
	const target = new URL(next?.startsWith('/rsvp/') ? '/' : next || '/?signedout=1', url.origin);
	if (next?.startsWith('/rsvp/')) target.searchParams.set('next', next);
	return redirect(target.href, 303);
};

export const GET: APIRoute = ({ redirect }) => redirect('/');
