import type { APIRoute } from 'astro';
import { guestRsvpsCsv, validEventId } from '@tca/school';

export const prerender = false;

export const GET: APIRoute = async ({ locals, url }) => {
	if (!locals.roles?.includes('admin')) return new Response('No access.', { status: 403 });
	const id = url.searchParams.get('id') || '';
	if (!validEventId(id)) return new Response('Event not found.', { status: 404 });
	return guestRsvpsCsv(id);
};
