import type { APIRoute } from 'astro';
import { readFormFile } from '@tca/school';

/** A file uploaded as a form answer: the family that uploaded it, or staff. */
export const prerender = false;
export const GET: APIRoute = async ({ url, locals }) => {
	if (!locals.family) return new Response('Not found', { status: 404 });
	const staff = locals.roles.includes('admin') || locals.roles.includes('staff');
	const file = await readFormFile({ assignmentId: url.searchParams.get('a') || '', questionId: url.searchParams.get('q') || '', familyId: staff ? undefined : locals.family.id });
	if (!file) return new Response('Not found', { status: 404 });
	const safe = file.name.replace(/[^\w. -]/g, '_');
	return new Response(file.data as BodyInit, { headers: { 'content-type': file.contentType, 'content-disposition': `inline; filename="${safe}"`, 'cache-control': 'private, no-cache', 'x-content-type-options': 'nosniff' } });
};
