import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = ({ redirect, url }) => {
	const clientId = process.env.GOOGLE_CLIENT_ID || '';
	if (!clientId) return redirect('/google-unavailable');
	const callback = new URL('/auth/google/callback', url.origin).toString();
	const target = new URL('https://accounts.google.com/o/oauth2/v2/auth');
	target.searchParams.set('client_id', clientId);
	target.searchParams.set('redirect_uri', callback);
	target.searchParams.set('response_type', 'code');
	target.searchParams.set('scope', 'openid email profile');
	target.searchParams.set('prompt', 'select_account');
	const link = url.searchParams.get('link') || '';
	if (link) target.searchParams.set('state', link);
	return redirect(target.toString());
};
