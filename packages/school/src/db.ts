import postgres from 'postgres';
import { SCHEMA_SQL } from './schema.ts';

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
	await db().unsafe(`
		do $$
		declare cname text;
		begin
			for cname in
				select con.conname
				from pg_constraint con
				join pg_class rel on rel.oid = con.conrelid
				where rel.relname = 'tour_slots' and con.contype = 'c'
					and pg_get_constraintdef(con.oid) ilike '%capacity%'
			loop
				execute format('alter table tour_slots drop constraint %I', cname);
			end loop;
			alter table tour_slots add constraint tour_slots_capacity_check check (capacity >= 1 and capacity <= 500);
			for cname in
				select con.conname
				from pg_constraint con
				join pg_class rel on rel.oid = con.conrelid
				where rel.relname = 'tour_holds' and con.contype = 'c'
					and pg_get_constraintdef(con.oid) ilike '%status%'
			loop
				execute format('alter table tour_holds drop constraint %I', cname);
			end loop;
			alter table tour_holds add constraint tour_holds_status_check check (status in ('new', 'contacted', 'confirmed', 'cancelled', 'proposed'));
		end $$;
	`);
	await db().unsafe(`
		insert into family_emails (id, family_id, email, is_primary, verified_at, password_hash, google_sub)
		select gen_random_uuid(), f.id, lower(f.email), true, f.email_verified_at,
			nullif(f.password_hash, ''), f.google_sub
		from families f
		where f.email <> ''
			and not exists (select 1 from family_emails e where e.family_id = f.id)
	`);
	await db().unsafe(`
		insert into notification_routes (family_id, category, email)
		select f.id, c.category, lower(f.email)
		from families f
		cross join (values ('announcements'), ('tours'), ('admin')) as c(category)
		where f.email <> ''
			and not exists (
				select 1 from notification_routes r
				where r.family_id = f.id and r.category = c.category
			)
	`);
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
