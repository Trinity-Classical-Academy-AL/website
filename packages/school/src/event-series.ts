import { randomUUID } from 'node:crypto';
import { db, dbReady } from './db.ts';
import { buildEventRow, upsertEvent, type CalendarEventInput } from './calendar.ts';
import { deleteEvent } from './data.ts';
import { chicagoToday } from './time.ts';
import { seriesHits } from './scheduling/schedule-series.ts';
import type { Result } from './result.ts';

/**
 * Repeating gatherings and school days, like a Google Calendar series. A rule
 * (weekdays, every N weeks or the nth weekday of the month, from–until) and a
 * template; each date is its own events row (series_id), so RSVPs stay per date.
 *
 * Edits and deletes take a scope:
 * - this: the one date leaves the series (its date is skipped) and changes alone;
 * - following: the series splits at that date; the new half takes the change;
 * - all: the rule and every date from today on take the change (past dates stay as they were).
 */
export type EventRule = { weekdays: number[]; everyWeeks: number; monthWeek: number | null; startsOn: string; endsOn: string };
export type EventSeries = EventRule & { id: string; skipDates: string[]; /** Every date the rule leaves out, including ones changed on their own. */ allSkips: string[] };
type Template = Omit<CalendarEventInput, 'date'>;

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const dayBefore = (date: string) => { const day = new Date(`${date}T12:00:00Z`); day.setUTCDate(day.getUTCDate() - 1); return day.toISOString().slice(0, 10); };

function checkRule(rule: EventRule): string | null {
	if (!validDate(rule.startsOn) || !validDate(rule.endsOn)) return 'Choose when it starts and until when it repeats.';
	if (rule.endsOn < rule.startsOn) return 'The last date must be after the first.';
	if (!rule.weekdays.length || rule.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) return 'Choose the day it repeats on.';
	if (rule.monthWeek && rule.weekdays.length !== 1) return 'Choose one weekday for a monthly event.';
	return null;
}

/** Every date the rule puts the event on (up to a year from its first date), less skipped ones. */
export function eventSeriesDates(rule: EventRule, skip: string[] = []): string[] {
	const dates: string[] = [];
	const limit = new Date(`${rule.startsOn}T12:00:00Z`); limit.setUTCFullYear(limit.getUTCFullYear() + 1);
	const day = new Date(`${rule.startsOn}T12:00:00Z`);
	while (day.toISOString().slice(0, 10) <= rule.endsOn && day <= limit) {
		const date = day.toISOString().slice(0, 10);
		if (!skip.includes(date) && seriesHits({ weekdays: rule.weekdays, startsOn: rule.startsOn, everyWeeks: rule.everyWeeks, monthWeek: rule.monthWeek }, date)) dates.push(date);
		day.setUTCDate(day.getUTCDate() + 1);
	}
	return dates;
}

function mapSeries(row: Record<string, any>): EventSeries {
	return {
		id: String(row.id), weekdays: (row.weekdays ?? []).map(Number), everyWeeks: Number(row.repeat_every || 1), monthWeek: row.month_week == null ? null : Number(row.month_week),
		startsOn: String(row.starts_on), endsOn: String(row.ends_on), skipDates: (row.skipped ?? []).map(String), allSkips: (row.all_skips ?? []).map(String),
	};
}

export async function getEventSeries(id: string): Promise<EventSeries | null> {
	await dbReady();
	// Skipped dates leave out ones changed on their own (those still happen, just not as part of the series).
	const [row] = await db()`select id, weekdays, repeat_every, month_week, starts_on::text, ends_on::text, array(select x::text from unnest(skip_dates) x) as all_skips,
		array(select x::text from unnest(skip_dates) x where not exists (select 1 from events e where e.detached_from = event_series.id and (e.starts_at at time zone 'America/Chicago')::date = x)) as skipped
		from event_series where id = ${id}`;
	return row ? mapSeries(row) : null;
}

/** A new repeating event: the rule, then one row per date. */
export async function createEventSeries(template: Template, rule: EventRule): Promise<Result<{ id: string; dates: number }>> {
	await dbReady();
	const bad = checkRule(rule);
	if (bad) return { ok: false, error: bad };
	const check = buildEventRow({ ...template, date: rule.startsOn, showPopup: false });
	if (!check.ok) return check;
	const dates = eventSeriesDates(rule);
	if (!dates.length) return { ok: false, error: 'Those days don’t fall between the first and last date.' };
	const id = randomUUID();
	await db()`insert into event_series (id, weekdays, repeat_every, month_week, starts_on, ends_on, template)
		values (${id}, ${rule.weekdays}, ${rule.everyWeeks}, ${rule.monthWeek}, ${rule.startsOn}, ${rule.endsOn}, ${db().json({ ...template, showPopup: false })})`;
	for (const date of dates) {
		const built = buildEventRow({ ...template, date, showPopup: false });
		if (built.ok) await upsertEvent(randomUUID(), built.row, template.imageKey, id);
	}
	return { ok: true, id, dates: dates.length };
}

/**
 * Apply the rule and template to the series' dates from `from` on: dates the
 * rule no longer hits are removed (RSVPs emailed), the rest take the change
 * (keeping their RSVPs), and missing dates are added.
 */
async function applySeries(id: string, input: Template, rule: EventRule, from: string): Promise<void> {
	// No new photo keeps the series' photo for dates added later.
	const [old] = await db()`select template from event_series where id = ${id}`;
	const template: Template = { ...input, imageKey: input.imageKey ?? (old?.template as Template | undefined)?.imageKey };
	await db()`update event_series set weekdays = ${rule.weekdays}, repeat_every = ${rule.everyWeeks}, month_week = ${rule.monthWeek},
		starts_on = ${rule.startsOn}, ends_on = ${rule.endsOn}, template = ${db().json({ ...template, showPopup: false })} where id = ${id}`;
	const series = (await getEventSeries(id))!;
	const wanted = new Set(eventSeriesDates(rule, series.allSkips).filter((date) => date >= from));
	const existing = await db()`select id, (starts_at at time zone 'America/Chicago')::date::text as day from events where series_id = ${id} and (starts_at at time zone 'America/Chicago')::date >= ${from}::date`;
	const have = new Set<string>();
	for (const row of existing) {
		const day = String(row.day);
		if (!wanted.has(day) || have.has(day)) { await deleteEvent(String(row.id)); continue; }
		have.add(day);
		const built = buildEventRow({ ...template, date: day, showPopup: false });
		if (built.ok) await upsertEvent(String(row.id), built.row, input.imageKey, id);
	}
	for (const day of wanted) {
		if (have.has(day)) continue;
		const built = buildEventRow({ ...template, date: day, showPopup: false });
		if (built.ok) await upsertEvent(randomUUID(), built.row, template.imageKey, id);
	}
}

/** Change every date from today on (past dates keep what they were). */
export async function updateEventSeries(id: string, template: Template, rule: EventRule): Promise<Result> {
	await dbReady();
	const bad = checkRule(rule);
	if (bad) return { ok: false, error: bad };
	const check = buildEventRow({ ...template, date: rule.startsOn, showPopup: false });
	if (!check.ok) return check;
	if (!(await getEventSeries(id))) return { ok: false, error: 'That event no longer repeats.' };
	await applySeries(id, template, rule, chicagoToday());
	return { ok: true };
}

/** Change this date and every one after it: the series splits at `from`. */
export async function updateEventSeriesFrom(id: string, from: string, template: Template, rule: EventRule): Promise<Result<{ id: string }>> {
	await dbReady();
	const series = await getEventSeries(id);
	if (!series) return { ok: false, error: 'That event no longer repeats.' };
	if (!validDate(from)) return { ok: false, error: 'Choose a date.' };
	const startsOn = rule.startsOn > from ? rule.startsOn : from;
	const next: EventRule = { ...rule, startsOn };
	const bad = checkRule(next);
	if (bad) return { ok: false, error: bad };
	const check = buildEventRow({ ...template, date: startsOn, showPopup: false });
	if (!check.ok) return check;
	if (from <= series.startsOn) { await applySeries(id, template, next, from); return { ok: true, id }; }
	const newId = randomUUID();
	await db().begin(async (tx) => {
		await tx`insert into event_series (id, weekdays, repeat_every, month_week, starts_on, ends_on, skip_dates, template)
			values (${newId}, ${next.weekdays}, ${next.everyWeeks}, ${next.monthWeek}, ${next.startsOn}, ${next.endsOn},
				${series.allSkips.filter((date) => date >= from)}::date[], ${tx.json({ ...template, showPopup: false })})`;
		await tx`update event_series set ends_on = ${dayBefore(from)}, skip_dates = ${series.allSkips.filter((date) => date < from)}::date[] where id = ${id}`;
		await tx`update events set series_id = ${newId} where series_id = ${id} and (starts_at at time zone 'America/Chicago')::date >= ${from}::date`;
	});
	await applySeries(newId, template, next, from);
	return { ok: true, id: newId };
}

/** This date only: it leaves the series (so the rule won't bring it back) and can then change alone. */
export async function detachEventOccurrence(eventId: string): Promise<void> {
	await dbReady();
	const [row] = await db()`select series_id, (starts_at at time zone 'America/Chicago')::date::text as day from events where id = ${eventId}`;
	if (!row?.series_id) return;
	await db()`update event_series set skip_dates = array_append(array_remove(skip_dates, ${row.day}::date), ${row.day}::date) where id = ${row.series_id}`;
	await db()`update events set series_id = null, detached_from = ${row.series_id} where id = ${eventId}`;
}

/** Delete one date (skipped in its series, so it stays gone). RSVPs are emailed. */
export async function deleteEventOccurrence(eventId: string): Promise<void> {
	await detachEventOccurrence(eventId);
	await deleteEvent(eventId);
}

/** Delete this date and every one after it; from the first date, the whole series. RSVPs are emailed. */
export async function deleteEventSeriesFrom(id: string, from: string): Promise<Result> {
	await dbReady();
	const series = await getEventSeries(id);
	if (!series) return { ok: false, error: 'That event no longer repeats.' };
	// No date means all of it: every date from today on goes, and so does the rule (past dates stay as a record).
	const start = from && validDate(from) ? from : chicagoToday();
	const rows = await db()`select id from events where series_id = ${id} and (starts_at at time zone 'America/Chicago')::date >= ${start}::date`;
	for (const row of rows) await deleteEvent(String(row.id));
	if (!from || start <= series.startsOn) await db()`delete from event_series where id = ${id}`;
	else await db()`update event_series set ends_on = ${dayBefore(start)} where id = ${id}`;
	return { ok: true };
}

/** Put a skipped date back. */
export async function restoreEventSeriesDate(id: string, date: string): Promise<Result> {
	await dbReady();
	const [row] = await db()`select template from event_series where id = ${id}`;
	if (!row) return { ok: false, error: 'That event no longer repeats.' };
	await db()`update event_series set skip_dates = array_remove(skip_dates, ${date}::date) where id = ${id}`;
	const series = (await getEventSeries(id))!;
	if (!eventSeriesDates(series, series.allSkips).includes(date)) return { ok: true };
	const [exists] = await db()`select 1 from events where series_id = ${id} and (starts_at at time zone 'America/Chicago')::date = ${date}::date`;
	if (exists) return { ok: true };
	const built = buildEventRow({ ...(row.template as Template), date, showPopup: false });
	if (built.ok) await upsertEvent(randomUUID(), built.row, (row.template as Template).imageKey, id);
	return { ok: true };
}

/** An existing one-off event becomes the first date of a new series (keeping its RSVPs). */
export async function adoptIntoSeries(eventId: string, seriesId: string): Promise<void> {
	await dbReady();
	const [row] = await db()`select (starts_at at time zone 'America/Chicago')::date::text as day from events where id = ${eventId}`;
	if (!row) return;
	const [twin] = await db()`select id from events where series_id = ${seriesId} and id <> ${eventId} and (starts_at at time zone 'America/Chicago')::date = ${row.day}::date`;
	if (!twin) return;
	await db()`delete from events where id = ${twin.id}`;
	await db()`update events set series_id = ${seriesId} where id = ${eventId}`;
	const [series] = await db()`select template from event_series where id = ${seriesId}`;
	const built = buildEventRow({ ...(series.template as Template), date: String(row.day), showPopup: false });
	if (built.ok) await upsertEvent(eventId, built.row, undefined, seriesId);
}
