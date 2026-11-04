import type { APIRoute } from 'astro';
import { listAdminTours, tourHoldsCsv } from '@tca/school';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
	if (!locals.roles?.includes('admin')) return new Response('No access.', { status: 403 });
	return tourHoldsCsv(await listAdminTours());
};
