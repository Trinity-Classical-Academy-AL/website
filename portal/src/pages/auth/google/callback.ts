import type { APIRoute } from 'astro';
import { FAMILY_COOKIE, FAMILY_SESSION_DAYS, issueFamilySession, signInWithGoogle } from '@tca/school';
import { landingAfterAuth } from '../../../lib/security.ts';

export const prerender = false;

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
	const code = url.searchParams.get('code') || '';
	const clientId = process.env.GOOGLE_CLIENT_ID || '';
	const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
	if (!code || !clientId || !clientSecret) return redirect('/google-unavailable');
	const callback = new URL('/auth/google/callback', url.origin).toString();
	const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: callback, grant_type: 'authorization_code' }),
	});
	if (!tokenResponse.ok) return redirect('/google-unavailable');
	const token = (await tokenResponse.json()) as { access_token?: string };
	if (!token.access_token) return redirect('/google-unavailable');
	const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
		headers: { authorization: `Bearer ${token.access_token}` },
	});
	if (!profileResponse.ok) return redirect('/google-unavailable');
	const profile = (await profileResponse.json()) as { sub?: string; email?: string; given_name?: string; family_name?: string; email_verified?: boolean };
	if (!profile.sub || !profile.email || profile.email_verified === false) return redirect('/google-unavailable');
	const family = await signInWithGoogle({
		sub: profile.sub,
		email: profile.email,
		givenName: profile.given_name || '',
		familyName: profile.family_name || '',
	});
	cookies.set(FAMILY_COOKIE, issueFamilySession(family.id), {
		httpOnly: true,
		path: '/',
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: FAMILY_SESSION_DAYS * 86400,
	});
	return redirect(landingAfterAuth(cookies, family.roles));
};
