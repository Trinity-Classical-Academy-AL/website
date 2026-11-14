import type { APIRoute } from 'astro';
import { readDocumentBytes } from '@tca/school';

export const prerender = false;

export const GET: APIRoute = async ({ url, locals }) => {
	const family = locals.family;
	if (!family) return new Response('Sign in required.', { status: 401 });
	const file = await readDocumentBytes({ id: family.id, roles: family.roles }, url.searchParams.get('id') || '');
	if (!file) return new Response('That document is not available to your family.', { status: 404 });
	return new Response(Buffer.from(file.data), {
		headers: {
			'content-type': file.contentType || 'application/octet-stream',
			'content-disposition': `attachment; filename="${file.name.replace(/["\r\n]/g, '')}"`,
			'x-content-type-options': 'nosniff',
			'cache-control': 'private, no-store',
		},
	});
};
