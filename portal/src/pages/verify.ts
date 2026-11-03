import type { APIRoute } from 'astro';
import { portalTokenLive } from '@tca/school';

export const prerender = false;

export const GET: APIRoute = async ({ url, redirect }) => {
	const token = url.searchParams.get('token') || '';
	const live = token ? await portalTokenLive(token) : null;
	if (!live) return redirect('/reset-expired');
	return redirect(`/setup?token=${encodeURIComponent(token)}`);
};
