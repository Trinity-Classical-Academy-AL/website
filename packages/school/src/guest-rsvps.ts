import type { Result } from './result.ts';
import { randomUUID } from 'node:crypto';
import { db, dbReady } from './db.ts';
import { csvResponse, toCsv } from './csv.ts';

export const validEventId = (id: string) => id.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export async function guestRsvpEvent(id: string) {
	if (!validEventId(id)) return null;
	await dbReady();
	const [row] = await db()`select id, title, description, starts_at, location,
		collect_rsvp and coalesce(ends_at, starts_at + interval '3 hours') > now() as open
		from events where id = ${id}`;
	return row ? { id: String(row.id), title: String(row.title), description: String(row.description),
		startsAt: new Date(row.starts_at).toISOString(), location: String(row.location), open: Boolean(row.open) } : null;
}

export async function accountRsvp(eventId: string, familyId: string) {
	if (!validEventId(eventId) || !validEventId(familyId)) return null;
	await dbReady();
	const [row] = await db()`select head_count as "headCount", note from rsvps where event_id = ${eventId} and family_id = ${familyId}`;
	return row || null;
}

export async function saveAccountRsvp(input: { eventId: string; familyId: string; headCount: number; note?: string }): Promise<Result> {
	if (!Number.isInteger(input.headCount) || input.headCount < 1) return { ok: false, error: 'Enter how many people are coming.' };
	const note = input.note?.trim();
	if (note && note.length > 1000) return { ok: false, error: 'Keep your note to 1,000 characters.' };
	if (!validEventId(input.eventId)) return { ok: false, error: 'RSVPs are closed for this event.' };
	if (!validEventId(input.familyId)) return { ok: false, error: 'Sign in to RSVP.' };
	await dbReady();
	// Availability and account existence are checked in the write, including stale forms.
	const rows = await db()`insert into rsvps (id, event_id, family_id, head_count, note)
		select ${randomUUID()}::uuid, e.id, f.id, ${input.headCount}, ${note ?? ''} from events e cross join families f
		where e.id = ${input.eventId} and f.id = ${input.familyId}
			and e.collect_rsvp and coalesce(e.ends_at, e.starts_at + interval '3 hours') > now()
		on conflict (event_id, family_id) do update set head_count = excluded.head_count,
			note = case when ${note !== undefined} then excluded.note else rsvps.note end, updated_at = now() returning id`;
	return rows.length ? { ok: true } : { ok: false, error: 'This account or event is no longer available for RSVPs.' };
}

export async function guestRsvps(eventId: string) {
	await dbReady();
	return await db()`select name, email, head_count as "headCount", note, created_at as "createdAt", updated_at as "updatedAt"
		from event_guest_rsvps where event_id = ${eventId} order by created_at`;
}

export async function eventRsvpTotals() {
	await dbReady();
	return await db()`select event_id as id, count(*)::int as responses, sum(head_count)::int as heads
		from (select event_id, head_count from rsvps union all select event_id, head_count from event_guest_rsvps) r group by event_id`;
}

// One row per account plus preserved anonymous responses from before account RSVPs.
export async function eventRsvps(eventId: string) {
	await dbReady();
	return await db()`select * from (
		select 'account' as type, f.name, f.email, r.head_count as "headCount", r.note,
			r.created_at as "createdAt", r.updated_at as "updatedAt"
		from rsvps r join families f on f.id = r.family_id where r.event_id = ${eventId}
		union all
		select 'guest (legacy)' as type, name, email, head_count, note, created_at, updated_at
		from event_guest_rsvps where event_id = ${eventId}
	) responses order by "createdAt"`;
}

export async function guestRsvpsCsv(eventId: string) {
	return csvResponse('event-rsvps.csv', toCsv(await eventRsvps(eventId), [
		{ key: 'type', label: 'Type' }, { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'headCount', label: 'Number attending' },
		{ key: 'note', label: 'Note' }, { key: 'createdAt', label: 'Received' }, { key: 'updatedAt', label: 'Updated' },
	]));
}
