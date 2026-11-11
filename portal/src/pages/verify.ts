import type { APIRoute } from 'astro';
import { portalTokenLive, recordAttempt, tooManyAttempts } from '@tca/school';

export const prerender = false;

export const GET: APIRoute = async ({ url, redirect, request }) => {
	const token = url.searchParams.get('token') || '';
	const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
	if (await tooManyAttempts('verify', ip, 20)) return redirect('/reset-expired');
	await recordAttempt('verify', ip);
	const live = token ? await portalTokenLive(token) : null;
	if (!live) return redirect('/reset-expired');
	return redirect(`/setup?token=${encodeURIComponent(token)}`);
};
