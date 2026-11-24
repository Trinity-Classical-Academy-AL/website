import type { APIRoute } from 'astro';
import { searchPlaces } from '@tca/school';

/** Location suggestions while typing (admins only, by the /admin gate). */
export const prerender = false;
export const GET: APIRoute = async ({ url }) => {
	const suggestions = await searchPlaces(url.searchParams.get('q') ?? '', url.searchParams.get('s') ?? '');
	return new Response(JSON.stringify({ suggestions }), { headers: { 'content-type': 'application/json', 'cache-control': 'private, max-age=60' } });
};
