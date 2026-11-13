import { db } from './db.ts';
import type { ClassReachCookie, ClassReachStore, StagedEvent, StagedPerson } from './classreach.ts';

export function createPostgresClassReachStore(): ClassReachStore {
	const sql = db();
	return {
		async claimHour(now) {
			const cutoff = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
			const rows = await sql`
				insert into settings (key, value)
				values ('classreach_sync_lock', ${sql.json({ at: now.toISOString() })})
				on conflict (key) do update
					set value = excluded.value
					where (settings.value->>'at')::timestamptz <= ${cutoff}::timestamptz
				returning key
			`;
			return rows.length > 0;
		},
		async loadSession() {
			const rows = await sql`
				select cookies, expires_at from classreach_sessions where id = 'primary'
			`;
			const row = rows[0] as { cookies: ClassReachCookie[] | null; expires_at: Date | string | null } | undefined;
			if (!row) return null;
			return {
				cookies: row.cookies ?? [],
				expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
			};
		},
		async saveSession(session) {
			await sql`
				insert into classreach_sessions (id, cookies, expires_at, updated_at)
				values ('primary', ${sql.json(session.cookies)}, ${session.expiresAt}, now())
				on conflict (id) do update
					set cookies = excluded.cookies, expires_at = excluded.expires_at, updated_at = now()
			`;
		},
		async matchFamily(email) {
			const normalized = email.trim().toLowerCase();
			if (!normalized) return null;
			const rows = await sql`
				select id from families where lower(email) = ${normalized}
				union
				select family_id as id from family_emails where lower(email) = ${normalized}
				limit 1
			`;
			return (rows[0] as { id: string } | undefined)?.id ?? null;
		},
		async upsertEvents(rows) {
			for (const row of rows) await upsertEvent(sql, row);
			return rows.length;
		},
		async upsertPeople(rows) {
			for (const row of rows) await upsertPerson(sql, row);
			return rows.length;
		},
		async recordRun(run) {
			await sql`
				insert into classreach_sync_runs (id, status, detail, events_upserted, people_upserted, finished_at)
				values (${crypto.randomUUID()}, ${run.status}, ${run.detail.slice(0, 500)}, ${run.events}, ${run.people}, now())
			`;
		},
		async alertStatus() {
			const rows = await sql`select status from classreach_alerts where id = 'primary'`;
			const status = (rows[0] as { status?: string } | undefined)?.status;
			return status === 'failing' || status === 'ok' ? status : null;
		},
		async saveAlert(status, reason) {
			await sql`
				insert into classreach_alerts (id, status, reason, updated_at)
				values ('primary', ${status}, ${reason.slice(0, 500)}, now())
				on conflict (id) do update set status = excluded.status, reason = excluded.reason, updated_at = now()
			`;
		},
	};
}

type Sql = ReturnType<typeof db>;

function upsertEvent(sql: Sql, row: StagedEvent) {
	return sql`
		insert into classreach_events (classreach_id, title, starts_on, ends_on, payload)
		values (${row.classreachId}, ${row.title}, ${row.startsOn}, ${row.endsOn}, ${sql.json(row.payload as never)})
		on conflict (classreach_id) do update set
			title = excluded.title,
			starts_on = excluded.starts_on,
			ends_on = excluded.ends_on,
			payload = excluded.payload,
			synced_at = now()
	`;
}

function upsertPerson(sql: Sql, row: StagedPerson) {
	const payload = sql.json(row.payload as never);
	const familyId = row.familyId;
	if (row.kind === 'family') {
		return sql`
			insert into classreach_families (classreach_id, directory_id, directory_name, email, full_name, family_id, payload)
			values (${row.classreachId}, ${row.directoryId}, ${row.directoryName}, ${row.email}, ${row.fullName}, ${familyId}, ${payload})
			on conflict (classreach_id) do update set
				directory_id = excluded.directory_id,
				directory_name = excluded.directory_name,
				email = excluded.email,
				full_name = excluded.full_name,
				family_id = coalesce(excluded.family_id, classreach_families.family_id),
				payload = excluded.payload,
				synced_at = now()
		`;
	}
	if (row.kind === 'student') {
		return sql`
			insert into classreach_students (classreach_id, directory_id, directory_name, email, full_name, family_id, payload)
			values (${row.classreachId}, ${row.directoryId}, ${row.directoryName}, ${row.email}, ${row.fullName}, ${familyId}, ${payload})
			on conflict (classreach_id) do update set
				directory_id = excluded.directory_id,
				directory_name = excluded.directory_name,
				email = excluded.email,
				full_name = excluded.full_name,
				family_id = coalesce(excluded.family_id, classreach_students.family_id),
				payload = excluded.payload,
				synced_at = now()
		`;
	}
	return sql`
		insert into classreach_guardians (classreach_id, directory_id, directory_name, email, full_name, family_id, payload)
		values (${row.classreachId}, ${row.directoryId}, ${row.directoryName}, ${row.email}, ${row.fullName}, ${familyId}, ${payload})
		on conflict (classreach_id) do update set
			directory_id = excluded.directory_id,
			directory_name = excluded.directory_name,
			email = excluded.email,
			full_name = excluded.full_name,
			family_id = coalesce(excluded.family_id, classreach_guardians.family_id),
			payload = excluded.payload,
			synced_at = now()
	`;
}
