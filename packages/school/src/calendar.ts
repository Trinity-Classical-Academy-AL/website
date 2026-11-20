import { randomUUID } from 'node:crypto';
import { db, dbReady } from './db.ts';
import { chicagoInputToIso } from './time.ts';
import { listTourSlotSummary } from './tours/slots.ts';
import type { Result } from './result.ts';

/**
 * One calendar for staff and families. An item answers when, who it's for
 * (audience) and how someone joins (sign-up). Type is a label with defaults:
 * Gathering (any audience, RSVP), Tour (prospective families, booking, from the
 * tour schedule) and School day (enrolled families, all day, no sign-up).
 * Gatherings and school days are stored as events; tours stay tour slots.
 */
export const CALENDAR_TYPES = [
	{ value: 'gathering', label: 'Gathering' },
	{ value: 'tour', label: 'Tour' },
	{ value: 'school_day', label: 'School day' },
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
	school_day: { audience: ['enrolled'], signup: 'none', allDay: true },
};

export type CalendarItem = {
	key: string; source: 'event' | 'tour'; id: string; type: CalendarType; title: string;
	date: string; start: string; end: string; allDay: boolean; audience: Audience[]; signup: 'none' | 'rsvp' | 'booking';
	location: string; description: string; capacity: number | null; taken: number; published: boolean; seriesId: string; capacityUnit: string;
	showPopup: boolean;
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
			showPopup: Boolean(row.feature_popup),
		};
	});
	const fromTours: CalendarItem[] = slots.map((slot) => ({
		key: `tour:${slot.id}`, source: 'tour', id: slot.id, type: 'tour',
		title: slot.type === 'open_house' ? 'Open house' : slot.type === 'info_night' ? 'Info night' : 'Campus tour',
		date: slot.date, start: slot.start.slice(0, 5), end: slot.end.slice(0, 5), allDay: false,
		audience: slot.published ? ['public', 'prospective'] : ['staff'], signup: 'booking', location: '', description: '',
		capacity: slot.capacity, taken: slot.taken, published: slot.published, seriesId: slot.seriesId, capacityUnit: slot.capacityUnit, showPopup: false,
	}));
	return [...fromEvents, ...fromTours].sort((a, b) => `${a.date} ${a.allDay ? '' : a.start}`.localeCompare(`${b.date} ${b.allDay ? '' : b.start}`));
}

/** Items a family can see: by audience (staff-only never shows). */
export function visibleTo(items: CalendarItem[], viewer: 'prospective' | 'enrolled'): CalendarItem[] {
	return items.filter((item) => item.type !== 'tour' && !item.audience.includes('staff') && (item.audience.includes('public') || item.audience.includes(viewer)));
}

/** Create or update a gathering or school day. */
export async function saveCalendarEvent(input: {
	id?: string; type: string; title: string; date: string; start: string; end: string; allDay: boolean;
	audience: string[]; rsvp: boolean; capacity: string; location: string; description: string; showPopup?: boolean;
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
	return { ok: true, id };
}
