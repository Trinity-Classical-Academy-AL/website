import type { APIRoute } from 'astro';
import { announcementEmailPreview, portalOrigin } from '@tca/school';

/** The composer's Email tab: the HTML this announcement would send, for a preview frame. */
export const prerender = false;
export const POST: APIRoute = async ({ request, url, locals }) => {
	if (!locals.roles?.includes('admin')) return new Response('Not found', { status: 404 });
	const form = await request.formData();
	const email = await announcementEmailPreview({ title: String(form.get('title') ?? ''), body: String(form.get('body') ?? ''), signOff: String(form.get('signOff') ?? ''), signedBy: String(form.get('signedBy') ?? '') });
	return Response.json({ subject: email.subject, html: email.html.replaceAll(`${portalOrigin()}/assets/`, `${url.origin}/assets/`) });
};
