import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, readdirSync } from 'node:fs';

const run = promisify(execFile);
const root = new URL('../', import.meta.url);
const databaseTest = (name, fn) => test(name, { skip: !process.env.DATABASE_URL }, fn);

async function child(source) {
	const { stdout } = await run(process.execPath, ['--input-type=module', '-e', source], {
		cwd: root, env: { ...process.env, RESEND_API_KEY: '', SCHOOL_NOTIFY_WEBHOOK_URL: '' },
	});
	return JSON.parse(stdout.trim());
}

const init = `
const { db, dbReady } = await import('./packages/school/src/db.ts');
let queries = 0;
db().options.debug = () => queries++;
try { await Promise.all([dbReady(), dbReady()]); console.log(JSON.stringify({ queries })); }
finally { await db().end(); }
`;

databaseTest('schema markers skip migrations across cold clients and serialize stale-marker repairs', async () => {
	const { db, dbReady } = await import('../packages/school/src/db.ts');
	const { SCHEMA_VERSION } = await import('../packages/school/src/db.ts');
	await dbReady();
	const warm = await child(init);
	// One marker read, plus postgres.js's built-in type discovery on a new connection.
	assert.equal(warm.queries, 2);
	await db()`update settings set value = '"performance-test-stale"'::jsonb where key = 'schema_version'`;
	try {
		await Promise.all([child(init), child(init)]);
		assert.equal((await db()`select value from settings where key = 'schema_version'`)[0].value, SCHEMA_VERSION);
		assert.equal((await child(init)).queries, 2);
	} finally {
		await db()`update settings set value = ${db().json(SCHEMA_VERSION)} where key = 'schema_version'`;
	}
});

databaseTest('failed schema applications do not advance the marker and dbReady can retry', async () => {
	const { db, dbReady, SCHEMA_VERSION } = await import('../packages/school/src/db.ts');
	await dbReady();
	await db()`update settings set value = '"performance-test-failed"'::jsonb where key = 'schema_version'`;
	try {
		const result = await child(`
const { db, dbReady } = await import('./packages/school/src/db.ts');
const { SCHEMA_SQL, MIGRATION_SQL } = await import('./packages/school/src/schema.ts');
const sql = db();
const begin = sql.begin;
let fail = true;
sql.begin = (task) => begin((tx) => {
 const unsafe = tx.unsafe;
 tx.unsafe = (text, ...args) => unsafe(fail && text === SCHEMA_SQL + MIGRATION_SQL ? 'select 1 / 0' : text, ...args);
 return task(tx);
});
try {
 let code;
 try { await dbReady(); } catch (error) { code = error.code; }
 const marker = (await sql\`select value from settings where key = 'schema_version'\`)[0].value;
 fail = false;
 await dbReady();
 console.log(JSON.stringify({ code, marker }));
} finally { await sql.end(); }
`);
		assert.equal(result.code, '22012');
		assert.equal(result.marker, 'performance-test-failed');
		assert.equal((await db()`select value from settings where key = 'schema_version'`)[0].value, SCHEMA_VERSION);
	} finally {
		await db()`update settings set value = ${db().json(SCHEMA_VERSION)} where key = 'schema_version'`;
	}
});

databaseTest('timing preserves lazy queries, builders, errors and transaction rollback, with isolated request counters', async () => {
	const { db, dbReady } = await import('../packages/school/src/db.ts');
	const { withDatabaseTiming } = await import('../packages/school/src/db-timing.ts');
	await dbReady();
	const counts = await Promise.all([1, 3].map((n) => withDatabaseTiming(async (metrics) => {
		const lazy = db()`select 42 as answer`;
		assert.equal(metrics.queries, 0);
		const results = await Promise.all(Array.from({ length: n }, () => db()`select pg_sleep(0.005)`));
		assert.equal(results.length, n);
		assert.equal(metrics.queries, n);
		assert.equal(metrics.active, 0);
		assert.ok(metrics.duration >= 4);
		const rows = await lazy;
		assert.equal(rows[0].answer, 42);
		await lazy;
		assert.equal(metrics.queries, n + 1, 'reusing a promise must not double-count');
		return metrics.queries;
	})));
	assert.deepEqual(counts, [2, 4]);
	await withDatabaseTiming(async (metrics) => {
		assert.equal((await db().unsafe('select 7 as answer').simple().values())[0][0], 7);
		assert.equal(await db().unsafe('select 1 / 0').catch((error) => error.code), '22012');
		let finalized = false;
		await db()`select 1`.finally(() => { finalized = true; });
		assert.equal(finalized, true);
		const key = `perf-${randomUUID()}`;
		await assert.rejects(db().begin(async (tx) => {
			await tx`insert into settings (key, value) values (${key}, 'true'::jsonb)`;
			throw new Error('rollback timing test');
		}), /rollback timing test/);
		assert.equal((await db()`select key from settings where key = ${key}`).length, 0);
		assert.equal(metrics.queries, 5);
		assert.equal(metrics.active, 0);
	});
});

databaseTest('family reads repair legacy accounts, preserve roles, and admin lists use bounded queries', async () => {
	const { db, dbReady, getFamily, listFamilies, listSignInEmails, listEnrolledFamilies, listProspectAccounts, saveProspectChildren, saveSchoolForm } = await import('@tca/school');
	const { withDatabaseTiming } = await import('../packages/school/src/db-timing.ts');
	await dbReady();
	const ids = Array.from({ length: 4 }, () => randomUUID());
	let tourSlotId;
	try {
		for (const [i, id] of ids.entries()) {
			await db()`insert into families (id, name, email, password_hash, roles) values (${id}, ${`Perf ${i}`}, ${`perf-${id}@example.com`}, null, ${i < 2 ? ['guardian'] : ['prospect', 'admin']})`;
		}
		const first = await getFamily(ids[0]);
		assert.ok(first.roles.includes('guardian'));
		assert.equal((await listSignInEmails(ids[0])).length, 1);
		assert.equal((await db()`select * from notification_routes where family_id = ${ids[0]}`).length, 3);
		await withDatabaseTiming(async (metrics) => {
			await getFamily(ids[0]);
			assert.equal(metrics.queries, 1);
		});
		assert.deepEqual((await listFamilies(first.email))[0].roles, first.roles);
		const kids = [[ids[0], 'Zed', '3'], [ids[0], 'Ada', '2'], [ids[1], 'Bea', '6']].map(([family, name, grade]) => ({ id: randomUUID(), family, name, grade }));
		for (const kid of kids) await db()`insert into children (id, family_id, kind, name, grade) values (${kid.id}, ${kid.family}, 'student', ${kid.name}, ${kid.grade})`;
		// Grade forms go to students enrolled this year (enrollments replaced students in the 2026-11 classroom release).
		const { schoolYearOf } = await import('@tca/school');
		for (const kid of kids) await db()`insert into enrollments (id, child_id, school_year, grade, status) values (${randomUUID()}, ${kid.id}, ${schoolYearOf()}, ${kid.grade}, 'enrolled')`;
		await withDatabaseTiming(async (metrics) => {
			const families = await listEnrolledFamilies();
			assert.equal(metrics.queries, 1);
			assert.deepEqual(families.find((f) => f.id === ids[0]).students.map((s) => s.name), ['Ada', 'Zed']);
			assert.equal(families.some((f) => f.id === ids[2]), false);
		});
		await saveProspectChildren({ familyId: ids[2], children: [{ firstName: 'Second', grade: 'K', schoolYear: '' }, { firstName: 'First', grade: '1', schoolYear: '2028' }], note: '' });
		const { addTourSlot } = await import('@tca/school');
		const slot = await addTourSlot({ date: '2027-04-21', start: '05:20', end: '05:30', capacity: 12 });
		assert.ok(slot.ok);
		tourSlotId = slot.id;
		await db()`insert into tour_holds (id, family_id, slot_id, kind, status) values (${randomUUID()}, ${ids[2]}, ${slot.id}, 'slot', 'confirmed'), (${randomUUID()}, ${ids[3]}, null, 'other', 'proposed')`;
		await withDatabaseTiming(async (metrics) => {
			const prospects = await listProspectAccounts();
			assert.equal(metrics.queries, 1);
			assert.equal(prospects.some((f) => f.id === ids[0]), false);
			assert.deepEqual(prospects.find((f) => f.id === ids[2]).children.map((c) => c.firstName), ['Second', 'First']);
			assert.match(prospects.find((f) => f.id === ids[2]).tour, /^Booked /);
			assert.equal(prospects.find((f) => f.id === ids[3]).tour, 'Time requested');
		});
		const form = await saveSchoolForm({ title: 'Perf grade assignment', instructions: '', audience: 'grade', grade: '2', dueOn: '', questions: [{ id: randomUUID(), label: 'OK?', type: 'yesno', required: true }], publish: true });
		assert.equal(form.ok, true);
		try {
			const assignments = await db()`select family_id from form_assignments where form_id = ${form.id} and family_id = any(${ids}::uuid[])`;
			assert.deepEqual(assignments.map((r) => r.family_id), [ids[0]]);
			await saveSchoolForm({ id: form.id, title: 'Perf grade assignment', instructions: '', audience: 'grade', grade: '2', dueOn: '', questions: [{ id: randomUUID(), label: 'OK?', type: 'yesno', required: true }], publish: true });
			assert.equal((await db()`select id from form_assignments where form_id = ${form.id} and family_id = any(${ids}::uuid[])`).length, 1);
		} finally { await db()`delete from school_forms where id = ${form.id}`; }
	} finally {
		await db()`delete from families where id = any(${ids}::uuid[])`;
		if (tourSlotId) await db()`delete from tour_slots where id = ${tourSlotId}`;
	}
});

test('all portal pages reuse the middleware family record and Astro sessions remain disabled', () => {
	const config = readFileSync(new URL('../portal/astro.config.mjs', import.meta.url), 'utf8');
	assert.match(config, /session: false/);
	const middleware = readFileSync(new URL('../portal/src/middleware.ts', import.meta.url), 'utf8');
	assert.match(middleware, /context.locals.family = family/);
	assert.match(middleware, /Server-Timing/);
	for (const file of readdirSync(new URL('../portal/src/pages/', import.meta.url), { recursive: true })) {
		if (!/\.(astro|ts)$/.test(file)) continue;
		const source = readFileSync(new URL(`../portal/src/pages/${file}`, import.meta.url), 'utf8');
		assert.doesNotMatch(source, /getFamily\((?:Astro\.)?locals.familyId\)/, file);
	}
});
