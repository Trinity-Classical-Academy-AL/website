import { classReachAlertAction, logClassReach, readClassReachEnv, syncClassReach } from './classreach.ts';
import { createPostgresClassReachStore } from './classreach-db.ts';
import { dbReady } from './db.ts';
import { notifyStaff } from './email.ts';

/** Long pull used by the background function. One failure log, and at most one alert until it recovers. */
export async function runClassReachSync() {
	const env = readClassReachEnv();
	const usernameSet = Boolean(env.CLASSREACH_USERNAME);
	const passwordSet = Boolean(env.CLASSREACH_PASSWORD);
	logClassReach('info', 'classreach_sync_begin', { usernameSet, passwordSet });
	if (!usernameSet || !passwordSet) {
		logClassReach('info', 'classreach_sync_skipped', { reason: 'credentials-unset', events: 0, people: 0 });
		return { skipped: true, reason: 'credentials-unset', events: 0, people: 0 };
	}
	const store = createPostgresClassReachStore();
	try {
		await dbReady();
		const result = await syncClassReach({
			env,
			fetch: (url, init) => fetch(url, init),
			sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
			store,
		});
		await reportAlert(store, true, '');
		return result;
	} catch (error) {
		const message = error instanceof Error ? error.message : 'ClassReach sync failed';
		logClassReach('error', 'classreach_sync_failed', { message, events: 0, people: 0 });
		try {
			await reportAlert(store, false, message);
		} catch (alertError) {
			logClassReach('error', 'classreach_sync_alert_failed', {
				message: alertError instanceof Error ? alertError.message : 'alert failed',
			});
		}
		return { skipped: true, reason: 'failed', events: 0, people: 0 };
	}
}

async function reportAlert(store: { alertStatus(): Promise<'ok' | 'failing' | null>; saveAlert(status: 'ok' | 'failing', reason: string): Promise<void> }, ok: boolean, reason: string) {
	const previous = await store.alertStatus();
	const action = classReachAlertAction(previous, ok);
	await store.saveAlert(ok ? 'ok' : 'failing', reason.slice(0, 500));
	if (action === 'fail') await notifyStaff('ClassReach sync failed', reason);
	if (action === 'recovered') await notifyStaff('ClassReach sync recovered', 'The ClassReach sync succeeded after a failure.');
}
