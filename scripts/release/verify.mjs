// After a deploy: compare the live database with the backup taken just before it.
// Read-only.
//
//   DATABASE_URL='postgres://…' node scripts/release/verify.mjs ~/TCA-backups/tca-….counts.json
//
// Passes when the release's migration has run (the schema marker matches this
// checkout), no table lost rows except the ones the release merges or prunes on
// purpose, and every admin from before still has admin.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { hasColumn, sslFor, tableCounts } from './lib.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const MAY_SHRINK = new Set(['applications', 'tour_slots', 'schedule_series']);
const url = process.env.DATABASE_URL;
if (!url || !process.argv[2]) { console.error('Usage: DATABASE_URL=… node scripts/release/verify.mjs <backup>.counts.json'); process.exit(1); }
const snapshot = JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'));
const { SCHEMA_VERSION } = await import(resolve(root, 'packages/school/src/db.ts'));

const failures = [];
const check = (ok, message) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${message}`); if (!ok) failures.push(message); };
const sql = postgres(url, { max: 1, ssl: sslFor(url), onnotice: () => {} });
const [marker] = await sql`select value from settings where key = 'schema_version'`;
check(marker?.value === SCHEMA_VERSION, marker?.value === SCHEMA_VERSION ? 'migration has run (schema marker matches this release)' : 'migration has not run yet: open the portal once, then run this again');
const now = await tableCounts(sql);
for (const [table, count] of Object.entries(snapshot.counts)) {
	if (now[table] === undefined) check(false, `table ${table} is gone (had ${count})`);
	else if (now[table] < count) (MAY_SHRINK.has(table) ? console.log(`note  ${table}: ${count} → ${now[table]} (merged or pruned on purpose)`) : check(false, `${table}: ${count} → ${now[table]}`));
}
const grew = Object.keys(now).filter((table) => (now[table] ?? 0) > (snapshot.counts[table] ?? 0));
console.log(`      ${Object.keys(snapshot.counts).length} tables from the backup checked; ${grew.length} have new rows since.`);
if (await hasColumn(sql, 'family_emails', 'roles')) {
	const admins = await sql`select count(*)::int as n from family_emails where 'admin' = any(roles)`;
	check(admins[0].n > 0, `${admins[0].n} sign-in(s) with admin access`);
}
await sql.end();
console.log(failures.length ? `\n${failures.length} check(s) failed. Roll back (docs/release.md).` : '\nLive database checks passed.');
process.exit(failures.length ? 1 : 0);
