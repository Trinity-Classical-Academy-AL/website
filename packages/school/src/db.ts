import postgres from 'postgres';
import { createHash } from 'node:crypto';
import { instrumentSql } from './db-timing.ts';
import { SCHEMA_SQL, MIGRATION_SQL } from './schema.ts';
import { incomingWritesAllowed } from './incoming/model.ts';

let client: ReturnType<typeof postgres> | null = null;
let ready: Promise<void> | null = null;

export function databaseUrl(): string {
	const url = process.env.DATABASE_URL ?? '';
	if (!url) {
		throw new Error('DATABASE_URL is not set. Point all three sites at the same Neon Postgres database.');
	}
	// Neon’s dashboard string includes channel_binding=require. node-postgres and postgres.js
	// do not implement that libpq option, and it can fail the handshake. Drop it and keep sslmode.
	return url
		.replace(/([?&])channel_binding=[^&]*&?/g, '$1')
		.replace(/[?&]$/, '');
}

export function db() {
	if (!client) {
		const url = databaseUrl();
		const local = /@(127\.0\.0\.1|localhost)[:/]/.test(url);
		client = instrumentSql(postgres(url, {
			ssl: local ? false : 'require',
			onnotice: () => undefined,
			max: 1,
			idle_timeout: 20,
			connect_timeout: 10,
			types: {
				date: {
					to: 1082,
					from: [1082],
					serialize: (value: string) => value,
					parse: (value: string) => value,
				},
			},
		}));
	}
	return client;
}

// Include every schema statement, compatibility migration and backfill in the marker.
export const SCHEMA_VERSION = createHash('sha256').update(SCHEMA_SQL).update(MIGRATION_SQL).digest('hex');
const SCHEMA_KEY = 'schema_version';

async function schemaCurrent(sql: Sql): Promise<boolean> {
	try {
		const rows = await sql`select key, value from settings where key in (${SCHEMA_KEY}, 'incoming_backfill_v1')`;
		if (rows.find(row => row.key === SCHEMA_KEY)?.value !== SCHEMA_VERSION) return false;
		// A preview may apply DDL, but must leave the data backfill for production.
		if (incomingWritesAllowed()) {
			if (!rows.some(row => row.key === 'incoming_backfill_v1')) return false;
		}
		return true;
	} catch (error) {
		// An empty database has no settings table. Other failures must still surface.
		if ((error as { code?: string }).code === '42P01') return false;
		throw error;
	}
}

async function applySchema(): Promise<void> {
	if (await schemaCurrent(db())) return;
	await db().begin(async (tx) => {
		// Serialize cold functions, including first creation of the settings table.
		await tx`select pg_advisory_xact_lock(1952670067, 1)`;
		await tx.unsafe(SCHEMA_SQL.slice(0, SCHEMA_SQL.indexOf(';') + 1));
		if (await schemaCurrent(tx as unknown as Sql)) return;
		// Simple protocol preserves statement order in one round trip. The transaction
		// keeps the marker and all existing migrations atomic if any statement fails.
		await tx`select set_config('tca.incoming_writes', ${incomingWritesAllowed() ? 'on' : 'off'}, true)`;
		await tx.unsafe(SCHEMA_SQL + MIGRATION_SQL).simple();
		await tx`
			insert into settings (key, value) values (${SCHEMA_KEY}, ${tx.json(SCHEMA_VERSION)})
			on conflict (key) do update set value = excluded.value
		`;
	});
}

export function dbReady(): Promise<void> {
	if (!ready) {
		ready = applySchema().catch((error: unknown) => {
			ready = null;
			throw error;
		});
	}
	return ready;
}

export type Sql = ReturnType<typeof postgres>;
