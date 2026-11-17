import { randomUUID } from 'node:crypto';
import { db, dbReady } from './db.ts';
import { csvResponse, toCsv } from './csv.ts';

export const validEventId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export async function guestRsvpEvent(id: string) {
	if (!validEventId(id)) return null;
	await dbReady();
	const [row] = await db()`select id, title, description, starts_at, location,
		collect_rsvp and coalesce(ends_at, starts_at + interval '3 hours') > now() as open
		from events where id = ${id}`;
	return row ? { id: String(row.id), title: String(row.title), description: String(row.description),
		startsAt: new Date(row.starts_at).toISOString(), location: String(row.location), open: Boolean(row.open) } : null;
}

export async function saveGuestRsvp(input: { eventId: string; name: string; email: string; headCount: number; note: string }) {
	const name = input.name.trim();
	const email = input.email.trim().toLowerCase();
	const note = input.note.trim();
	if (!name || name.length > 160) return { ok: false, error: 'Enter your name (up to 160 characters).' };
	if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Enter an email address like name@example.com.' };
	if (!Number.isInteger(input.headCount) || input.headCount < 1 || input.headCount > 20) return { ok: false, error: 'Choose between 1 and 20 people.' };
	if (note.length > 1000) return { ok: false, error: 'Keep your note to 1,000 characters.' };
	if (!validEventId(input.eventId)) return { ok: false, error: 'RSVPs are closed for this event.' };
	await dbReady();
	// Check availability in the write, including when a form was left open past the deadline.
	const rows = await db()`insert into event_guest_rsvps (id, event_id, name, email, head_count, note)
		select ${randomUUID()}::uuid, id, ${name}, ${email}, ${input.headCount}, ${note} from events
		where id = ${input.eventId} and collect_rsvp and coalesce(ends_at, starts_at + interval '3 hours') > now()
		on conflict (event_id, lower(email)) do update set name = excluded.name,
			head_count = excluded.head_count, note = excluded.note, updated_at = now() returning id`;
	return rows.length ? { ok: true } : { ok: false, error: 'RSVPs are closed for this event.' };
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

export async function guestRsvpsCsv(eventId: string) {
	return csvResponse('event-guests.csv', toCsv(await guestRsvps(eventId), [
		{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'headCount', label: 'Number attending' },
		{ key: 'note', label: 'Note' }, { key: 'createdAt', label: 'Received' }, { key: 'updatedAt', label: 'Updated' },
	]));
}
