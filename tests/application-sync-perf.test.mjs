import { test } from 'node:test';
import assert from 'node:assert/strict';

/** Page views call syncApplications(); once everything is synced it must be a single read, not work per inquiry. */
test('application sync skips interview requests that have not changed', async (t) => {
	if (!process.env.DATABASE_URL) { t.skip('DATABASE_URL is not set'); return; }
	const { db, dbReady, syncApplications } = await import('@tca/school');
	await dbReady();
	await syncApplications();
	let queries = 0;
	const debug = db().options.debug;
	db().options.debug = () => { queries++; };
	try {
		await syncApplications();
	} finally {
		db().options.debug = debug;
	}
	assert.equal(queries, 1);
});
