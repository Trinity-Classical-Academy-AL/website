// 15-minute paced ClassReach pull. Only the hourly function, which sends the shared token, may call it.
import { classReachSyncAuthorized, logClassReach } from '../../../packages/school/src/classreach.ts';
import { runClassReachSync } from '../../../packages/school/src/classreach-run.ts';

const SYNC_BUDGET_MS = 14 * 60 * 1000;

export default async function classreachSyncBackground(req: Request) {
	const secret = process.env['FAMILY_SESSION_SECRET'] || process.env['CLASSREACH_PASSWORD'] || '';
	if (!classReachSyncAuthorized(secret, req.headers.get('x-classreach-sync'))) {
		return new Response('Sign in required.', { status: 401 });
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			runClassReachSync(),
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error('ClassReach sync timed out')), SYNC_BUDGET_MS);
			}),
		]);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'ClassReach sync failed';
		if (message === 'ClassReach sync timed out') logClassReach('error', 'classreach_sync_failed', { message, events: 0, people: 0 });
	} finally {
		if (timer) clearTimeout(timer);
	}
	return new Response(null, { status: 202 });
}
