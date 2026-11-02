import postgres from 'postgres';
import { SCHEMA_SQL } from './schema.ts';

let client: ReturnType<typeof postgres> | null = null;
let ready: Promise<void> | null = null;

export function databaseUrl(): string {
	const url = process.env.DATABASE_URL ?? '';
	if (!url) {
		throw new Error('DATABASE_URL is not set. Point all three sites at the same Neon Postgres database.');
	}
	return url;
}

export function db() {
	if (!client) {
		const url = databaseUrl();
		const local = /@(127\.0\.0\.1|localhost)[:/]/.test(url);
		client = postgres(url, {
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
		});
	}
	return client;
}

async function applySchema(): Promise<void> {
	const statements = SCHEMA_SQL.split(';')
		.map((statement) => statement.trim())
		.filter(Boolean);
	for (const statement of statements) {
		await db().unsafe(statement);
	}
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
