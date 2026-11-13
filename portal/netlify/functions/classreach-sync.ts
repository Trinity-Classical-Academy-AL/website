// Reads CLASSREACH_USERNAME and CLASSREACH_PASSWORD at runtime on tca-portal-al. A missing pair logs and returns.
import { runScheduledClassReachSync } from '../../../packages/school/src/classreach-run.ts';

export default async function classreachSync() {
	try {
		const result = await runScheduledClassReachSync();
		return Response.json({ ok: true, ...result });
	} catch {
		return Response.json({ ok: false }, { status: 500 });
	}
}

export const config = {
	schedule: '17 * * * *',
};
