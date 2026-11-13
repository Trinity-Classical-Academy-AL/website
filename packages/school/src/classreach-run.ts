import { logClassReach, readClassReachEnv, syncClassReach } from './classreach.ts';
import { createPostgresClassReachStore } from './classreach-db.ts';
import { dbReady } from './db.ts';
import { notifyStaff } from './email.ts';

export async function runScheduledClassReachSync() {
	const env = readClassReachEnv();
	const usernameSet = Boolean(env.CLASSREACH_USERNAME);
	const passwordSet = Boolean(env.CLASSREACH_PASSWORD);
	logClassReach('info', 'classreach_sync_begin', { usernameSet, passwordSet });
	if (!usernameSet || !passwordSet) {
		logClassReach('info', 'classreach_sync_skipped', { reason: 'credentials-unset', events: 0, people: 0 });
		return { skipped: true, reason: 'credentials-unset', events: 0, people: 0 };
	}
	await dbReady();
	try {
		return await syncClassReach({
			env,
			fetch: (url, init) => fetch(url, init),
			sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
			store: createPostgresClassReachStore(),
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'ClassReach sync failed';
		logClassReach('error', 'classreach_sync_failed', { message, events: 0, people: 0 });
		try {
			await notifyStaff('ClassReach sync failed', message);
		} catch (alertError) {
			logClassReach('error', 'classreach_sync_alert_failed', {
				message: alertError instanceof Error ? alertError.message : 'alert failed',
			});
		}
		throw error;
	}
}
