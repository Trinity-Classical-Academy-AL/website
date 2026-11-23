// Full backup of a database before a release: a pg_dump (custom format), a row
// count for every table, and a SHA-256 of the dump, checked by listing it back.
// Read-only against the source database.
//
//   DATABASE_URL='postgres://…' node scripts/release/backup.mjs [--out ~/TCA-backups]
//
// Writes <out>/tca-<host>-<timestamp>.dump, .counts.json and .sha256. Keep a copy
// somewhere other than this laptop (Google Drive, an external disk).
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import postgres from 'postgres';
import { PG_IMAGE, docker, dockerUrl, sslFor, tableCounts } from './lib.mjs';

const arg = (name, fallback) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : fallback; };
const url = process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL to the database to back up.'); process.exit(1); }
const host = new URL(url).hostname;
const out = resolve(arg('--out', resolve(homedir(), 'TCA-backups')).replace(/^~/, homedir()));
mkdirSync(out, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const name = `tca-${host.split('.')[0]}-${stamp}`;
const dump = resolve(out, `${name}.dump`);

console.log(`Backing up ${host} to ${dump}`);
const sql = postgres(url, { max: 1, ssl: sslFor(url), onnotice: () => {} });
const [{ version }] = await sql`select current_setting('server_version') as version`;
const before = await tableCounts(sql);
// The dump runs in Docker so pg_dump is never older than the server.
docker(['run', '--rm', '-v', `${dirname(dump)}:/out`, PG_IMAGE, 'pg_dump', '--format=custom', '--no-owner', '--no-privileges', `--file=/out/${basename(dump)}`, dockerUrl(url)], 'pg_dump');
const after = await tableCounts(sql);
await sql.end();

const listing = docker(['run', '--rm', '-v', `${dirname(dump)}:/out`, PG_IMAGE, 'pg_restore', '--list', `/out/${basename(dump)}`], 'pg_restore --list');
const dataEntries = listing.split('\n').filter((line) => / TABLE DATA public /.test(line)).length;
const hash = createHash('sha256');
for await (const chunk of createReadStream(dump)) hash.update(chunk);
const sha = hash.digest('hex');

const moved = Object.keys(after).filter((table) => after[table] !== before[table]);
writeFileSync(resolve(out, `${name}.counts.json`), JSON.stringify({ host, serverVersion: version, takenAt: new Date().toISOString(), dump: basename(dump), sha256: sha, counts: before }, null, 2));
writeFileSync(resolve(out, `${name}.sha256`), `${sha}  ${basename(dump)}\n`);

const tables = Object.keys(before).length;
console.log(`Postgres ${version}; ${tables} tables, ${Object.values(before).reduce((a, b) => a + b, 0)} rows; ${dataEntries} table data entries in the dump.`);
if (moved.length) console.log(`Note: rows changed during the dump in ${moved.join(', ')} (normal if the site is in use; the dump is one consistent snapshot).`);
if (dataEntries < tables) { console.error(`The dump lists ${dataEntries} tables of data but the database has ${tables}.`); process.exit(1); }
console.log(`OK  ${dump}\n    sha256 ${sha}`);
