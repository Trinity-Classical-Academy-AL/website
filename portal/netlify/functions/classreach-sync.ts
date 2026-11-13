// Hourly trigger. It only queues the paced pull so it stays inside the 30s schedule limit.
import { queueClassReachSync, readClassReachEnv } from '../../../packages/school/src/classreach.ts';

export default async function classreachSync() {
	const env = readClassReachEnv();
	const site = process.env['URL'] || process.env['DEPLOY_PRIME_URL'] || '';
	const secret = process.env['FAMILY_SESSION_SECRET'] || env.CLASSREACH_PASSWORD || '';
	await queueClassReachSync({
		env,
		site,
		secret,
		fetch: (url, init) => fetch(url, init),
	});
	return Response.json({ ok: true });
}

export const config = {
	schedule: '17 * * * *',
};
