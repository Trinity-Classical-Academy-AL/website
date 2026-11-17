import type { APIRoute } from 'astro';
import { beginGoogleState } from '../../lib/security.ts';

export const prerender = false;

export const GET: APIRoute = ({ redirect, url, cookies }) => {
	const clientId = process.env.GOOGLE_CLIENT_ID || '';
	if (!clientId) return redirect('/?error=google');
	const callback = new URL('/auth/google/callback', url.origin).toString();
	const target = new URL('https://accounts.google.com/o/oauth2/v2/auth');
	target.searchParams.set('client_id', clientId);
	target.searchParams.set('redirect_uri', callback);
	target.searchParams.set('response_type', 'code');
	target.searchParams.set('scope', 'openid email profile');
	target.searchParams.set('prompt', 'select_account');
	const hint = url.searchParams.get('login_hint') || '';
	if (hint) target.searchParams.set('login_hint', hint);
	const link = url.searchParams.get('link') || '';
	target.searchParams.set('state', beginGoogleState(cookies, url.protocol === 'https:', link));
	return redirect(target.toString());
};
