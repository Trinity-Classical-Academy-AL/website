import type { APIRoute } from 'astro';
import { applyClassReachIngest, bearerAuthorized, createPostgresClassReachStore, dbReady, notifyStaff } from '@tca/school';

export const prerender = false;

function json(body: Record<string, unknown>, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
	});
}

export const POST: APIRoute = async ({ request }) => {
	const secret = process.env['CLASSREACH_INGEST_TOKEN'] ?? '';
	if (!secret) return json({ ok: false, error: 'ingest-not-configured' }, 503);
	if (!bearerAuthorized(secret, request.headers.get('authorization'))) return json({ ok: false }, 401);
	let body: unknown;
	try {
		const raw = await request.text();
		if (raw.length > 8_000_000) return json({ ok: false, error: 'too-large' }, 413);
		body = JSON.parse(raw);
	} catch {
		return json({ ok: false, error: 'invalid-json' }, 400);
	}
	await dbReady();
	const result = await applyClassReachIngest({
		body,
		store: createPostgresClassReachStore(),
		notify: notifyStaff,
	});
	return json(result.body, result.status);
};
