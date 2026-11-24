import type { APIRoute } from 'astro';
import { readApplicantFile } from '@tca/school';

/** A teaching candidate's own upload (their household only). Reviewers use /admin/hiring-file. */
export const prerender = false;
export const GET: APIRoute = async ({ url, locals }) => {
	if (!locals.family) return new Response('Not found', { status: 404 });
	const file = await readApplicantFile({ applicantId: url.searchParams.get('a') || '', key: url.searchParams.get('k') || '', familyId: locals.family.id });
	if (!file) return new Response('Not found', { status: 404 });
	const safe = file.name.replace(/[^\w. -]/g, '_');
	return new Response(file.data as BodyInit, { headers: { 'content-type': file.contentType, 'content-disposition': `inline; filename="${safe}"`, 'cache-control': 'private, no-cache', 'x-content-type-options': 'nosniff' } });
};
