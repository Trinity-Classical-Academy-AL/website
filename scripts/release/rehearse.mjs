// Rehearse a release's migration on a copy of production, never on production.
//
//   node scripts/release/rehearse.mjs ~/TCA-backups/tca-….dump [--rollback main]
//
// 1. Restores the dump into a throwaway Postgres in Docker (127.0.0.1:55441).
// 2. Runs this checkout's real boot migration (dbReady) on it, as production
//    would, plus the applications sync, with mail and Formaloo switched off.
// 3. Checks nothing was lost: no table shrinks except the ones this release
//    merges or prunes on purpose, every admin keeps admin, every family, child
//    and application survives.
// 4. With --rollback <ref>, boots that ref's code (for example main) on the
//    migrated copy, to show whether a code-only rollback would still start.
//
// Exits non-zero on any failed check. The container is left running for a look
// around; remove it with: docker rm -f tca-rehearsal
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import postgres from 'postgres';
import { PG_IMAGE, adminEmails, docker, hasColumn, tableCounts } from './lib.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dump = resolve(process.argv[2] || '');
const rollbackAt = process.argv.indexOf('--rollback');
const rollbackRef = rollbackAt > 0 ? process.argv[rollbackAt + 1] : '';
if (!process.argv[2]) { console.error('Usage: node scripts/release/rehearse.mjs <file.dump> [--rollback main]'); process.exit(1); }

// This release merges sibling applications into one per family and prunes unbooked
// non-tour times; settings only grows. Every other table must keep every row.
const MAY_SHRINK = new Set(['applications', 'tour_slots', 'schedule_series']);
const NAME = 'tca-rehearsal', PORT = '55441';
const URL_ = `postgres://tca:tca@127.0.0.1:${PORT}/tca_rehearsal`;

const failures = [];
const check = (ok, message) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${message}`); if (!ok) failures.push(message); };

// 1. A fresh copy.
spawnSync('docker', ['rm', '-f', NAME]);
docker(['run', '--detach', '--name', NAME, '--publish', `127.0.0.1:${PORT}:5432`, '-v', `${dirname(dump)}:/dumps:ro`,
	'--env', 'POSTGRES_USER=tca', '--env', 'POSTGRES_PASSWORD=tca', '--env', 'POSTGRES_DB=tca_rehearsal', PG_IMAGE], 'start rehearsal Postgres');
let sql;
for (let attempt = 0; attempt < 60; attempt++) {
	try { sql = postgres(URL_, { max: 1, onnotice: () => {} }); await sql`select 1`; break; } catch { await sql?.end().catch(() => {}); sql = undefined; await delay(500); }
}
if (!sql) throw new Error('Rehearsal Postgres did not start.');
// Restore with the same pg_restore inside the container; owner and grants are Neon's, not ours.
const restore = spawnSync('docker', ['exec', NAME, 'pg_restore', '--no-owner', '--no-privileges', '--exit-on-error', '-U', 'tca', '-d', 'tca_rehearsal', `/dumps/${basename(dump)}`], { encoding: 'utf8' });
if (restore.status !== 0) { console.error(restore.stderr); throw new Error('pg_restore failed.'); }
console.log(`Restored ${basename(dump)} into ${NAME}.`);

// 2. Before.
const before = await tableCounts(sql);
const adminsBefore = await adminEmails(sql);
const familiesBefore = (await sql`select id from families ${await hasColumn(sql, 'families', 'merged_into_id') ? sql`where merged_into_id is null` : sql``}`).map((row) => String(row.id));
const kidIds = new Set();
for (const table of ['students', 'prospect_children', 'children']) {
	const [exists] = await sql`select to_regclass(${table}) as t`;
	if (exists.t) for (const row of await sql.unsafe(`select id from "${table}"`)) kidIds.add(String(row.id));
}
const hadApplications = before.applications !== undefined;
const applicantsBefore = hadApplications ? (await sql`select distinct coalesce(family_id::text, 'e:' || lower(email)) as k from applications`).map((row) => row.k) : [];
const [{ version: schemaBefore } = {}] = await sql`select value as version from settings where key = 'schema_version'`.catch(() => []);
await sql.end();

// 3. Migrate exactly as a production cold start would.
Object.assign(process.env, { DATABASE_URL: URL_, INCOMING_PRODUCTION: 'yes' });
for (const key of ['RESEND_API_KEY', 'SCHOOL_NOTIFY_WEBHOOK_URL', 'FORMALOO_API_KEY', 'FORMALOO_API_SECRET', 'FORMALOO_WEBHOOK_TOKEN', 'CONTEXT']) delete process.env[key];
const school = await import(resolve(root, 'packages/school/src/index.ts'));
const { SCHEMA_VERSION } = await import(resolve(root, 'packages/school/src/db.ts'));
const started = Date.now();
try { await school.dbReady(); } catch (error) { check(false, `boot migration failed: ${error.message}`); }
console.log(`Boot migration took ${Date.now() - started} ms.`);
if (!failures.length) {
	try { await school.syncApplications(); check(true, 'applications sync runs on the migrated copy'); } catch (error) { check(false, `applications sync failed: ${error.message}`); }
}

// 4. After.
sql = postgres(URL_, { max: 1, onnotice: () => {} });
const after = await tableCounts(sql);
for (const [table, count] of Object.entries(before)) {
	const now = after[table];
	if (now === undefined) check(false, `table ${table} is gone (had ${count} rows)`);
	else if (now < count) (MAY_SHRINK.has(table) ? console.log(`note  ${table}: ${count} → ${now} (merged or pruned on purpose)`) : check(false, `${table} lost rows: ${count} → ${now}`));
}
check(true, `${Object.keys(before).length} existing tables kept; ${Object.keys(after).length - Object.keys(before).length} new`);
const adminsAfter = new Set((await sql`select lower(email) as email from family_emails where 'admin' = any(roles)`).map((row) => row.email));
const lostAdmins = adminsBefore.filter((email) => !adminsAfter.has(email));
check(lostAdmins.length === 0, `every admin keeps admin (${adminsBefore.length})${lostAdmins.length ? `; lost: ${lostAdmins.join(', ')}` : ''}`);
const familiesAfter = new Set((await sql`select id from families`).map((row) => String(row.id)));
check(familiesBefore.every((id) => familiesAfter.has(id)), `every family kept (${familiesBefore.length})`);
const childrenAfter = new Set((await sql`select id from children`).map((row) => String(row.id)));
const lostKids = [...kidIds].filter((id) => !childrenAfter.has(id));
check(lostKids.length === 0, `every student and prospective child is in children (${kidIds.size})${lostKids.length ? `; missing ${lostKids.length}` : ''}`);
if (hadApplications) {
	const keys = new Set((await sql`select coalesce(family_id::text, 'e:' || lower(email)) as k from applications a left join families f on f.id = a.family_id`).map((row) => row.k));
	// A merged household's application moves to the family it merged into.
	const merged = new Map((await sql`select id, merged_into_id from families where merged_into_id is not null`).map((row) => [String(row.id), String(row.merged_into_id)]));
	const missing = applicantsBefore.filter((key) => !keys.has(key) && !keys.has(merged.get(key) ?? ''));
	check(missing.length === 0, `every family or email with an application still has one (${applicantsBefore.length})`);
}
const [{ version: schemaAfter }] = await sql`select value as version from settings where key = 'schema_version'`;
check(schemaAfter === SCHEMA_VERSION && schemaAfter !== schemaBefore, 'schema marker updated to this release');
await sql.end();
await school.db().end?.();

// 5. Would the old code still start on the migrated database?
if (rollbackRef && !failures.some((message) => message.startsWith('boot'))) {
	const dir = mkdtempSync(resolve(tmpdir(), 'tca-rollback-'));
	const add = spawnSync('git', ['worktree', 'add', '--detach', dir, rollbackRef], { cwd: root, encoding: 'utf8' });
	if (add.status !== 0) check(false, `could not check out ${rollbackRef}: ${add.stderr}`);
	else {
		// Shared dependencies, but @tca/* must be that ref's own packages, not this checkout's.
		mkdirSync(resolve(dir, 'node_modules/@tca'), { recursive: true });
		for (const entry of readdirSync(resolve(root, 'node_modules'))) if (entry !== '@tca') symlinkSync(resolve(root, 'node_modules', entry), resolve(dir, 'node_modules', entry));
		for (const name of readdirSync(resolve(dir, 'packages'))) symlinkSync(resolve(dir, 'packages', name), resolve(dir, 'node_modules/@tca', name));
		const boot = spawnSync(process.execPath, ['--input-type=module', '-e', `const s = await import(${JSON.stringify(resolve(dir, 'packages/school/src/index.ts'))}); await s.dbReady(); await s.db().end();`],
			{ cwd: dir, encoding: 'utf8', env: { ...process.env, DATABASE_URL: URL_ }, timeout: 120000 });
		check(boot.status === 0, `${rollbackRef}'s code boots on the migrated copy (code-only rollback)${boot.status === 0 ? '' : `: ${(boot.stderr || '').split('\n').find((line) => /error/i.test(line)) || boot.stderr.slice(0, 300)}`}`);
		// And forward again: this release's code on a database the old code has touched.
		const forward = spawnSync(process.execPath, ['--input-type=module', '-e', `const s = await import(${JSON.stringify(resolve(root, 'packages/school/src/index.ts'))}); await s.dbReady(); await s.db().end();`],
			{ cwd: root, encoding: 'utf8', env: { ...process.env, DATABASE_URL: URL_ }, timeout: 120000 });
		check(forward.status === 0, `this release boots again after ${rollbackRef} ran (roll forward)${forward.status === 0 ? '' : `: ${(forward.stderr || '').slice(0, 300)}`}`);
		spawnSync('git', ['worktree', 'remove', '--force', dir], { cwd: root });
	}
	rmSync(dir, { recursive: true, force: true });
}

console.log(failures.length ? `\n${failures.length} check(s) failed.` : '\nRehearsal passed.');
console.log(`Copy left at ${URL_} (docker rm -f ${NAME} when done).`);
process.exit(failures.length ? 1 : 0);
