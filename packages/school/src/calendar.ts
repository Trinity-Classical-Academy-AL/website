import { randomUUID } from 'node:crypto';
import { db, dbReady } from './db.ts';
import { chicagoInputToIso } from './time.ts';
import { listTourSlotSummary } from './tours/slots.ts';
import type { Result } from './result.ts';

/**
 * One calendar for staff and families. An item answers when, who it's for
 * (audience) and how someone joins (sign-up). Type is a label with defaults:
 * Gathering (any audience, RSVP), Tour (prospective families, booking, from the
 * tour schedule), Interview (shared interview times only invited families can
 * book) and School day (enrolled families, all day, no sign-up). Gatherings and
 * school days are stored as events; tours and interviews are bookable times.
 */
export const CALENDAR_TYPES = [
	{ value: 'gathering', label: 'Gathering' },
	{ value: 'tour', label: 'Tour' },
	{ value: 'interview', label: 'Interview' },
	{ value: 'school_day', label: 'Schedule' },
] as const;
export type CalendarType = (typeof CALENDAR_TYPES)[number]['value'];
export const AUDIENCES = [
	{ value: 'public', label: 'Public', hint: 'Website and everyone in the portal' },
	{ value: 'prospective', label: 'Prospective families', hint: 'Families applying or visiting' },
	{ value: 'enrolled', label: 'Enrolled families', hint: 'The family calendar' },
	{ value: 'staff', label: 'Staff only', hint: 'Only staff see it' },
] as const;
export type Audience = (typeof AUDIENCES)[number]['value'];
export const TYPE_DEFAULTS: Record<CalendarType, { audience: Audience[]; signup: 'none' | 'rsvp' | 'booking'; allDay: boolean }> = {
	gathering: { audience: ['prospective', 'enrolled'], signup: 'rsvp', allDay: false },
	tour: { audience: ['prospective'], signup: 'booking', allDay: false },
	interview: { audience: ['prospective'], signup: 'booking', allDay: false },
	school_day: { audience: ['enrolled'], signup: 'none', allDay: true },
};

export type CalendarItem = {
	key: string; source: 'event' | 'tour'; id: string; type: CalendarType; title: string;
	date: string; start: string; end: string; allDay: boolean; audience: Audience[]; signup: 'none' | 'rsvp' | 'booking';
	location: string; description: string; capacity: number | null; taken: number; published: boolean; seriesId: string; capacityUnit: string;
	showPopup: boolean; hasImage: boolean;
};

const chicagoParts = (iso: string) => {
	const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
		.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
	return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${String(Number(parts.hour) % 24).padStart(2, '0')}:${parts.minute}` };
};

/** Every calendar item: gatherings and school days (events) plus tour times. */
export async function listCalendar(): Promise<CalendarItem[]> {
	await dbReady();
	const [events, slots] = await Promise.all([
		db()`select e.*, (select coalesce(sum(r.head_count), 0)::int from rsvps r where r.event_id = e.id) as taken from events e order by starts_at`,
		listTourSlotSummary(),
	]);
	const fromEvents: CalendarItem[] = events.map((row) => {
		const start = chicagoParts(new Date(row.starts_at).toISOString());
		const end = row.ends_at ? chicagoParts(new Date(row.ends_at).toISOString()) : null;
		return {
			key: `event:${row.id}`, source: 'event', id: String(row.id), type: (row.type === 'school_day' ? 'school_day' : 'gathering') as CalendarType,
			title: String(row.title), date: start.date, start: row.all_day ? '' : start.time, end: row.all_day || !end ? '' : end.time, allDay: Boolean(row.all_day),
			audience: (row.audience ?? []) as Audience[], signup: row.collect_rsvp ? 'rsvp' : 'none', location: String(row.location || ''),
			description: String(row.description || ''), capacity: row.capacity ?? null, taken: Number(row.taken || 0), published: true, seriesId: '', capacityUnit: 'people',
			showPopup: Boolean(row.feature_popup), hasImage: Boolean(row.image_key),
		};
	});
	const fromTours: CalendarItem[] = slots.map((slot) => ({
		key: `tour:${slot.id}`, source: 'tour', id: slot.id, type: slot.type === 'interview' ? 'interview' : 'tour',
		title: slot.type === 'open_house' ? 'Open house' : slot.type === 'info_night' ? 'Info night' : slot.type === 'interview' ? 'Interview' : 'Campus tour',
		date: slot.date, start: slot.start.slice(0, 5), end: slot.end.slice(0, 5), allDay: false,
		// Interviews are only for invited families; tours are public.
		audience: !slot.published ? ['staff'] : slot.type === 'interview' ? ['prospective'] : ['public', 'prospective'], signup: 'booking', location: '', description: '',
		capacity: slot.capacity, taken: slot.taken, published: slot.published, seriesId: slot.seriesId, capacityUnit: slot.capacityUnit, showPopup: false, hasImage: false,
	}));
	return [...fromEvents, ...fromTours].sort((a, b) => `${a.date} ${a.allDay ? '' : a.start}`.localeCompare(`${b.date} ${b.allDay ? '' : b.start}`));
}

/** Items a family can see: by audience (staff-only never shows). */
export function visibleTo(items: CalendarItem[], viewer: 'prospective' | 'enrolled'): CalendarItem[] {
	return items.filter((item) => item.source !== 'tour' && !item.audience.includes('staff') && (item.audience.includes('public') || item.audience.includes(viewer)));
}

/** Create or update a gathering or school day. */
export async function saveCalendarEvent(input: {
	id?: string; type: string; title: string; date: string; start: string; end: string; allDay: boolean;
	audience: string[]; rsvp: boolean; capacity: string; location: string; description: string; showPopup?: boolean;
	/** A new photo's stored key, or 'remove' to clear it; omitted keeps the current one. */
	imageKey?: string;
}): Promise<Result<{ id: string }>> {
	await dbReady();
	const type = input.type === 'school_day' ? 'school_day' : 'gathering';
	const title = input.title.trim().slice(0, 160);
	if (!title) return { ok: false, error: 'Add a title.' };
	if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false, error: 'Choose a date.' };
	const allDay = type === 'school_day' || input.allDay;
	if (!allDay && !/^\d{2}:\d{2}$/.test(input.start)) return { ok: false, error: 'Add a start time, or make it all day.' };
	if (!allDay && input.end && input.end <= input.start) return { ok: false, error: 'End after it starts.' };
	const audience = [...new Set(input.audience.filter((value) => AUDIENCES.some((item) => item.value === value)))];
	if (!audience.length) return { ok: false, error: 'Choose who it’s for.' };
	const startsAt = chicagoInputToIso(`${input.date}T${allDay ? '00:00' : input.start}`);
	const endsAt = allDay ? chicagoInputToIso(`${input.date}T23:59`) : input.end ? chicagoInputToIso(`${input.date}T${input.end}`) : null;
	const capacity = /^\d+$/.test(input.capacity.trim()) && Number(input.capacity) > 0 ? Number(input.capacity) : null;
	const rsvp = type === 'gathering' && input.rsvp;
	const isPublic = audience.includes('public');
	const id = input.id || randomUUID();
	if (input.showPopup) await db()`update events set feature_popup = false where id <> ${id}`;
	await db()`
		insert into events (id, title, description, starts_at, ends_at, location, show_on_website, feature_popup, collect_rsvp, type, audience, all_day, capacity)
		values (${id}, ${title}, ${input.description.trim()}, ${startsAt}, ${endsAt}, ${input.location.trim()}, ${isPublic}, ${Boolean(input.showPopup && isPublic)}, ${rsvp}, ${type}, ${audience}, ${allDay}, ${capacity})
		on conflict (id) do update set title = excluded.title, description = excluded.description, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
			location = excluded.location, show_on_website = excluded.show_on_website, feature_popup = excluded.feature_popup, collect_rsvp = excluded.collect_rsvp,
			type = excluded.type, audience = excluded.audience, all_day = excluded.all_day, capacity = excluded.capacity`;
	if (input.imageKey) await db()`update events set image_key = ${input.imageKey === 'remove' ? '' : input.imageKey} where id = ${id}`;
	return { ok: true, id };
}

export type CalendarPerson = { name: string; email: string; phone: string; headCount: number; status: string; note: string; detail: string };

/** Who signed up: RSVPs for a gathering, bookings for a tour. Cancelled bookings sort last. */
export async function calendarPeople(item: Pick<CalendarItem, 'source' | 'id'>): Promise<CalendarPerson[]> {
	await dbReady();
	if (item.source === 'tour') {
		const rows = await db()`select family_name, email, phone, head_count, status, note, grades from tour_holds where slot_id = ${item.id}
			order by (status = 'cancelled'), created_at`;
		return rows.map((row) => ({
			name: String(row.family_name || row.email), email: String(row.email || ''), phone: String(row.phone || ''), headCount: Number(row.head_count || 1),
			status: String(row.status), note: String(row.note || ''), detail: Array.isArray(row.grades) && row.grades.length ? `Grades ${row.grades.join(', ')}` : '',
		}));
	}
	const rows = await db()`select coalesce(nullif(f.household_name, ''), f.name, f.email) as name, f.email, r.head_count, r.note from rsvps r join families f on f.id = r.family_id
		where r.event_id = ${item.id}
		union all select name, email, head_count, note from event_guest_rsvps where event_id = ${item.id}`;
	return rows.map((row) => ({ name: String(row.name || row.email), email: String(row.email || ''), phone: '', headCount: Number(row.head_count || 1), status: 'coming', note: String(row.note || ''), detail: '' }));
}

/**
 * Every sign-up across the calendar in one list: RSVPs to gatherings, tour
 * bookings, and requests for a tour at another time (which need a reply).
 */
export type Signup = {
	id: string; kind: 'rsvp' | 'booking' | 'request'; itemKey: string; itemTitle: string; date: string; start: string;
	name: string; email: string; phone: string; headCount: number; status: string; note: string; otherTime: string; createdAt: string;
};
export async function listSignups(): Promise<Signup[]> {
	await dbReady();
	const [rsvps, holds] = await Promise.all([
		db()`select r.event_id, e.title, e.starts_at, e.all_day, coalesce(nullif(f.household_name, ''), f.name, f.email) as name, f.email, r.head_count, r.note, r.created_at
			from rsvps r join events e on e.id = r.event_id join families f on f.id = r.family_id
			union all select g.event_id, e.title, e.starts_at, e.all_day, g.name, g.email, g.head_count, g.note, g.created_at
			from event_guest_rsvps g join events e on e.id = g.event_id`,
		db()`select h.id, h.kind, h.status, h.family_name, h.email, h.phone, h.head_count, h.note, h.other_time, h.created_at, h.slot_id,
			s.slot_date::text as slot_date, s.start_time, s.slot_type
			from tour_holds h left join tour_slots s on s.id = h.slot_id`,
	]);
	const stamp = (value: unknown) => value instanceof Date ? value.toISOString() : String(value ?? '');
	const fromRsvps: Signup[] = rsvps.map((row, index) => {
		const when = chicagoParts(new Date(row.starts_at).toISOString());
		return { id: `rsvp-${row.event_id}-${index}`, kind: 'rsvp', itemKey: `event:${row.event_id}`, itemTitle: String(row.title), date: when.date, start: row.all_day ? '' : when.time,
			name: String(row.name || row.email), email: String(row.email || ''), phone: '', headCount: Number(row.head_count || 1), status: 'coming', note: String(row.note || ''), otherTime: '', createdAt: stamp(row.created_at) };
	});
	const fromHolds: Signup[] = holds.map((row) => ({
		id: String(row.id), kind: row.kind === 'other' ? 'request' : 'booking', itemKey: row.slot_id ? `tour:${row.slot_id}` : '',
		itemTitle: row.slot_type === 'open_house' ? 'Open house' : row.slot_type === 'info_night' ? 'Info night' : row.slot_type === 'interview' ? 'Interview' : 'Campus tour',
		date: String(row.slot_date ?? ''), start: row.start_time ? String(row.start_time).slice(0, 5) : '',
		name: String(row.family_name || row.email), email: String(row.email || ''), phone: String(row.phone || ''), headCount: Number(row.head_count || 1),
		status: String(row.status), note: String(row.note || ''), otherTime: String(row.other_time || ''), createdAt: stamp(row.created_at),
	}));
	return [...fromRsvps, ...fromHolds].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.start.localeCompare(b.start) || a.createdAt.localeCompare(b.createdAt));
}
