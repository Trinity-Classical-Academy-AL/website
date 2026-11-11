import type { APIRoute } from 'astro';
import { db, dbReady, logPortalEvent } from '@tca/school';

export const prerender = false;

export const GET: APIRoute = async () => {
	try {
		await dbReady();
		await db()`select 1 as ok`;
		return new Response(JSON.stringify({ ok: true }), {
			headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
		});
	} catch (error) {
		logPortalEvent('error', 'health_failed', { message: error instanceof Error ? error.message : 'unknown' });
		return new Response(JSON.stringify({ ok: false }), {
			status: 503,
			headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
		});
	}
};
