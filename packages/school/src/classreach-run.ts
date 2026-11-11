import { syncClassReach } from './classreach.ts';
import { createPostgresClassReachStore } from './classreach-db.ts';
import { dbReady } from './db.ts';
import { notifyStaff } from './email.ts';

function logSync(level: 'info' | 'error', event: string, fields: Record<string, unknown>) {
	const line = JSON.stringify({ at: new Date().toISOString(), level, event, ...fields });
	if (level === 'error') console.error(line);
	else console.info(line);
}

export async function runScheduledClassReachSync() {
	if (!process.env.CLASSREACH_USERNAME || !process.env.CLASSREACH_PASSWORD) {
		logSync('info', 'classreach_sync_skipped', { reason: 'credentials-unset' });
		return { skipped: true, reason: 'credentials-unset', events: 0, people: 0 };
	}
	await dbReady();
	try {
		return await syncClassReach({
			env: process.env,
			fetch: (url, init) => fetch(url, init),
			sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
			store: createPostgresClassReachStore(),
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'ClassReach sync failed';
		logSync('error', 'classreach_sync_failed', { message });
		try {
			await notifyStaff('ClassReach sync failed', message);
		} catch (alertError) {
			logSync('error', 'classreach_sync_alert_failed', {
				message: alertError instanceof Error ? alertError.message : 'alert failed',
			});
		}
		throw error;
	}
}
