import type { APIRoute } from 'astro';
import { eventImageKey, readFlyerBytes } from '@tca/school';

/** An event's photo, for signed-in families and staff. */
export const prerender = false;
export const GET: APIRoute = async ({ params, locals }) => {
	if (!locals.family) return new Response('Not found', { status: 404 });
	const key = await eventImageKey(params.id || '');
	const file = key ? await readFlyerBytes(key) : null;
	if (!file || !file.contentType.startsWith('image/')) return new Response('Not found', { status: 404 });
	return new Response(file.data as BodyInit, { headers: { 'content-type': file.contentType, 'cache-control': 'private, no-cache', 'x-content-type-options': 'nosniff' } });
};
