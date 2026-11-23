// Shared by the release scripts (backup, rehearse, verify).
import { spawnSync } from 'node:child_process';

// pg tools run in Docker so they are never older than the server (production Neon runs Postgres 18).
export const PG_IMAGE = 'postgres:18';

export const isLocal = (url) => ['127.0.0.1', 'localhost'].includes(new URL(url).hostname);
/** The same database as seen from inside a container. */
export const dockerUrl = (url) => { const next = new URL(url); if (isLocal(url)) next.hostname = 'host.docker.internal'; return next.href; };
export const sslFor = (url) => isLocal(url) ? false : 'require';

export function docker(args, label) {
	const result = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
	if (result.status !== 0) throw new Error(`${label} failed:\n${result.stderr || result.error}`);
	return result.stdout;
}

/** Row count of every table in public. */
export async function tableCounts(sql) {
	const tables = await sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`;
	const counts = {};
	for (const { table_name } of tables) counts[table_name] = Number((await sql.unsafe(`select count(*)::int as n from "${table_name}"`))[0].n);
	return counts;
}

/** Emails with admin access, under either model: the household (families.roles) or the person (family_emails.roles). */
export async function adminEmails(sql) {
	const rows = await sql.unsafe(`
		select lower(f.email) as email from families f where 'admin' = any(f.roles) and f.email <> ''
		${await hasColumn(sql, 'family_emails', 'roles') ? `union select lower(e.email) from family_emails e where 'admin' = any(e.roles)` : ''}`);
	return [...new Set(rows.map((row) => row.email))].sort();
}

export async function hasColumn(sql, table, column) {
	const [row] = await sql`select 1 from information_schema.columns where table_schema = 'public' and table_name = ${table} and column_name = ${column}`;
	return !!row;
}
