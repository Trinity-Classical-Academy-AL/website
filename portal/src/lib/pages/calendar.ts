import type { AstroGlobal } from 'astro';
import { runActions, toastFrom } from '../actions.ts';
import { csrfToken } from '../security.ts';
import {
	AUDIENCES, CALENDAR_TYPES, TYPE_DEFAULTS, addTourSlot, calendarPeople, chicagoToday, deleteEvent, deleteTourSeries, deleteTourSeriesFrom, deleteTourSlot, skipTourSeriesDate, listCalendar, listSeries, listSignups, saveCalendarEvent, saveFlyerBytes, saveSeries, updateTourSlot,
	adoptIntoSeries, createEventSeries, deleteEventOccurrence, deleteEventSeriesFrom, detachEventOccurrence, detachSeriesOccurrence, getEventSeries, restoreEventSeriesDate, splitSeries, updateEventSeries, updateEventSeriesFrom,
	type CalendarItem, type CalendarType, type ScheduleSeries,
} from '@tca/school';

/** URL-safe key for an item's full page: event:<id> ⇄ event-<id>. */
export const itemPath = (key: string) => `/admin/calendar/${key.replace(':', '-')}`;
export const keyFromPath = (slug: string) => slug.replace(/^(event|tour)-/, '$1:');

/**
 * The add/edit actions shared by the calendar sheet and an item's full page,
 * and the form's starting values: what was typed (after an error), the item
 * being edited, or the type's defaults.
 */
/** The Repeats fields as a rule: which weekdays, every N weeks, or the nth weekday of the month. */
function repeatPattern(form: FormData) {
	const repeats = String(form.get('repeats') ?? '');
	return repeats === 'weekdays' ? { weekdays: [1, 2, 3, 4, 5], everyWeeks: 1, monthWeek: null }
		: repeats === 'monthly' ? { weekdays: [Number(form.get('monthDay'))], everyWeeks: 1, monthWeek: Number(form.get('monthWeek')) }
		: { weekdays: form.getAll('weekdays').map(Number), everyWeeks: repeats === '3weeks' ? 3 : repeats === '2weeks' ? 2 : 1, monthWeek: null };
}
/** Editing or deleting one date of a repeating item: just it, it and the ones after, or all of them. */
type Scope = 'this' | 'following' | 'all';
const scopeOf = (form: FormData): Scope => { const value = String(form.get('scope') ?? ''); return value === 'following' || value === 'all' ? value : 'this'; };

async function calendarActions(Astro: AstroGlobal, after: { saved: (date: string, id: string) => string; deleted: (date: string) => string }) {
	let draft: Record<string, string> | null = null;
	let draftAudience: string[] | null = null;
	const remember = (form: FormData) => {
		draft = Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)]));
		draftAudience = form.getAll('audience').map(String);
		draft.weekdays = form.getAll('weekdays').map(Number).join(',');
	};
	const result = await runActions(Astro, {
		'save-event': async (form) => {
			const read = (key: string) => String(form.get(key) ?? '');
			remember(form);
			// An optional photo for the family Events page: a new upload replaces it, the checkbox removes it.
			let imageKey: string | undefined = form.get('removeImage') === 'on' ? 'remove' : undefined;
			const image = form.get('image');
			if (image instanceof File && image.size) {
				if (!/^image\/(png|jpeg|webp|gif)$/.test(image.type)) return { error: 'Choose a JPG, PNG, WebP or GIF photo.' };
				if (image.size > 10 * 1024 * 1024) return { error: 'Photos must be 10 MB or smaller.' };
				imageKey = (await saveFlyerBytes(new Uint8Array(await image.arrayBuffer()), { name: image.name, contentType: image.type })).key;
			}
			const template = {
				type: read('type'), title: read('title'), start: read('start'), end: read('end'),
				allDay: form.get('allDay') === 'on', audience: form.getAll('audience').map(String), rsvp: form.get('rsvp') === 'on',
				capacity: read('capacity'), location: read('location'), description: read('description'), showPopup: form.get('popup') === 'on', imageKey,
			};
			const rule = { ...repeatPattern(form), startsOn: read('startsOn'), endsOn: read('endsOn') };
			const seriesId = read('seriesId');
			const repeating = read('repeats') && read('repeats') !== 'once';
			if (seriesId) {
				// One date of a repeating event: change just it, it and the ones after, or every date.
				const scope = scopeOf(form);
				if (scope === 'this') {
					await detachEventOccurrence(read('id'));
					const saved = await saveCalendarEvent({ id: read('id'), ...template, date: read('date') });
					return saved.ok ? { redirect: after.saved(read('date'), `event:${saved.id}`) } : { error: saved.error };
				}
				const saved = scope === 'following' ? await updateEventSeriesFrom(seriesId, read('occurrence'), template, rule) : await updateEventSeries(seriesId, template, rule);
				return saved.ok ? { redirect: after.saved(read('occurrence') || rule.startsOn, scope === 'all' ? `event:${read('id')}` : '') } : { error: saved.error };
			}
			if (repeating) {
				const created = await createEventSeries(template, rule);
				if (!created.ok) return { error: created.error };
				// Making an existing event repeat keeps it (and its RSVPs) as one of the dates.
				if (read('id')) await adoptIntoSeries(read('id'), created.id);
				return { redirect: after.saved(rule.startsOn, '') };
			}
			const saved = await saveCalendarEvent({ id: read('id') || undefined, ...template, date: read('date') });
			return saved.ok ? { redirect: after.saved(read('date'), `event:${saved.id}`) } : { error: saved.error };
		},
		'save-tour': async (form) => {
			const read = (key: string) => String(form.get(key) ?? '');
			remember(form);
			const input = {
				date: read('date'), start: read('start'), end: read('end'), capacity: Number(read('capacity')), type: read('kind') === 'interview' ? 'interview' : 'tour', // Open houses and info nights are gatherings now.
				published: form.get('published') === 'on', capacityUnit: (read('unit') === 'people' ? 'people' : 'families') as 'people' | 'families',
			};
			const repeats = read('repeats');
			const seriesId = read('seriesId');
			const scope = scopeOf(form);
			// One date of a repeating tour, changed on its own: it leaves the schedule (keeping its bookings).
			if (seriesId && scope === 'this' && read('id')) {
				await detachSeriesOccurrence(read('id'));
				const saved = await updateTourSlot({ id: read('id'), ...input });
				return saved.ok ? { redirect: after.saved(read('date'), `tour:${read('id')}`) } : { error: saved.error };
			}
			if (repeats && repeats !== 'once') {
				// A repeating tour: one schedule that puts a tour on each matching date between two dates.
				const window = read('window');
				const seriesInput = { ...input, ...repeatPattern(form), startsOn: read('startsOn'), endsOn: read('endsOn'), bookingWindowDays: window === '' ? null : Number(window) };
				const saved = seriesId && scope === 'following' ? await splitSeries(seriesId, read('occurrence'), seriesInput)
					: await saveSeries({ id: seriesId || undefined, ...seriesInput });
				return saved.ok ? { redirect: read('id') ? after.saved(read('startsOn'), `tour:${read('id')}`) : after.saved(read('startsOn'), '') } : { error: saved.error };
			}
			const saved = read('id') ? await updateTourSlot({ id: read('id'), ...input }) : await addTourSlot(input);
			const id = read('id') || ('id' in saved ? String(saved.id) : '');
			return saved.ok ? { redirect: after.saved(read('date'), `tour:${id}`) } : { error: saved.error };
		},
		'delete-event': async (form) => {
			// A repeating event's date: just it (skipped), it and the ones after, or every date from today on.
			const id = String(form.get('id') ?? ''), date = String(form.get('date') ?? ''), seriesId = String(form.get('seriesId') ?? '');
			const scope = scopeOf(form);
			if (seriesId && scope !== 'this') {
				const removed = await deleteEventSeriesFrom(seriesId, scope === 'following' ? date : '');
				return removed.ok ? { redirect: after.deleted(date) } : { error: removed.error };
			}
			if (seriesId) await deleteEventOccurrence(id); else await deleteEvent(id);
			return { redirect: after.deleted(date) };
		},
		'delete-series': async (form) => {
			const removed = await deleteTourSeries(String(form.get('seriesId') ?? ''));
			return removed.ok ? { redirect: after.deleted(String(form.get('date') ?? '')) } : { error: removed.error ?? 'Couldn’t delete those dates.' };
		},
		'restore-date': async (form) => {
			// Puts a skipped date of a repeating event or tour back.
			const date = String(form.get('date') ?? '');
			if (String(form.get('item') ?? '').startsWith('event:')) {
				const restored = await restoreEventSeriesDate(String(form.get('seriesId') ?? ''), date);
				return restored.ok ? { redirect: after.saved(date, String(form.get('item') ?? '')) } : { error: restored.error };
			}
			const restored = await skipTourSeriesDate(String(form.get('seriesId') ?? ''), date, true);
			return restored.ok ? { redirect: after.saved(date, String(form.get('item') ?? '')) } : { error: restored.error ?? 'Couldn’t restore that date.' };
		},
		'delete-tour': async (form) => {
			// A repeating tour's date: just it (skipped), it and the ones after, or every date. Bookings are emailed.
			const seriesId = String(form.get('seriesId') ?? ''), date = String(form.get('date') ?? '');
			const scope = scopeOf(form);
			if (seriesId && scope !== 'this') {
				const removed = scope === 'following' ? await deleteTourSeriesFrom(seriesId, date) : await deleteTourSeries(seriesId);
				return removed.ok ? { redirect: after.deleted(date) } : { error: removed.error ?? 'Couldn’t delete those dates.' };
			}
			const removed = await deleteTourSlot(String(form.get('id') ?? ''));
			return removed.ok ? { redirect: after.deleted(String(form.get('date') ?? '')) } : { error: removed.error };
		},
	});
	return { result, draft: draft as Record<string, string> | null, draftAudience: draftAudience as string[] | null };
}

function formValues(editing: CalendarItem | null, sheetType: CalendarType, newDate: string, d: Record<string, string> | null, draftAudience: string[] | null, series: ScheduleSeries | null = null) {
	const defaults = TYPE_DEFAULTS[sheetType];
	const tour = sheetType === 'tour' || sheetType === 'interview';
	return {
		id: editing?.id ?? '', title: d?.title ?? editing?.title ?? (sheetType === 'school_day' ? 'No school' : ''),
		date: d?.date ?? editing?.date ?? newDate,
		start: d?.start ?? editing?.start ?? (tour ? '09:00' : '18:00'), end: d?.end ?? editing?.end ?? (tour ? '10:00' : '19:30'),
		allDay: d ? d.allDay === 'on' : editing?.allDay ?? defaults.allDay,
		audience: draftAudience ?? editing?.audience ?? defaults.audience,
		rsvp: d ? d.rsvp === 'on' : editing ? editing.signup === 'rsvp' : defaults.signup === 'rsvp',
		capacity: d?.capacity ?? (editing?.capacity ? String(editing.capacity) : sheetType === 'interview' ? '1' : tour ? '6' : ''),
		unit: d?.unit ?? editing?.capacityUnit ?? 'families',
		published: d ? d.published === 'on' : editing?.published ?? true,
		location: d?.location ?? editing?.location ?? '', description: d?.description ?? editing?.description ?? '', popup: editing?.showPopup ?? false,
		// Weekly tours: the schedule's days, date range and how far ahead families can book.
		repeats: d?.repeats ?? (series ? repeatsOf(series) : 'once'), seriesId: series?.id ?? '', scope: d?.scope ?? 'this',
		weekdays: d ? (d.weekdays ? d.weekdays.split(',').map(Number) : []) : series?.weekdays ?? (newDate ? [new Date(`${newDate}T12:00:00Z`).getUTCDay()] : []),
		startsOn: d?.startsOn ?? series?.startsOn ?? newDate, endsOn: d?.endsOn ?? series?.endsOn ?? (newDate ? shiftMonths(newDate, 3) : ''),
		window: d?.window ?? (series ? String(series.bookingWindowDays ?? '') : '92'),
		monthWeek: Number(d?.monthWeek ?? series?.monthWeek ?? (newDate ? nthOf(newDate) : 1)),
		monthDay: Number(d?.monthDay ?? (series?.monthWeek ? series.weekdays[0] : newDate ? new Date(`${newDate}T12:00:00Z`).getUTCDay() : 2)),
	};
}
/** The Repeats choice a saved schedule matches. */
const repeatsOf = (series: ScheduleSeries) => series.monthWeek ? 'monthly' : series.everyWeeks === 3 ? '3weeks' : series.everyWeeks === 2 ? '2weeks'
	: series.weekdays.join() === '1,2,3,4,5' ? 'weekdays' : 'weekly';
/** Which week of its month a date falls in: 1–4, or 5 for the last. */
const nthOf = (date: string) => { const day = new Date(`${date}T12:00:00Z`); const next = new Date(day); next.setUTCDate(day.getUTCDate() + 7); return next.getUTCMonth() !== day.getUTCMonth() ? 5 : Math.ceil(day.getUTCDate() / 7); };
const shiftMonths = (date: string, months: number) => { const day = new Date(`${date}T12:00:00Z`); day.setUTCMonth(day.getUTCMonth() + months); return day.toISOString().slice(0, 10); };
const seriesFor = async (item: CalendarItem | null): Promise<ScheduleSeries | null> => {
	if (!item?.seriesId) return null;
	if (item.source === 'tour') return (await listSeries()).find((series) => series.id === item.seriesId) ?? null;
	// A repeating event's rule, in the same shape the form reads for tours.
	const rule = await getEventSeries(item.seriesId);
	return rule ? { id: rule.id, type: item.type, weekdays: rule.weekdays, start: item.start, end: item.end, startsOn: rule.startsOn, endsOn: rule.endsOn, capacity: item.capacity ?? 0, capacityUnit: 'people', published: true, bookingWindowDays: null, skipDates: rule.skipDates, families: 0, everyWeeks: rule.everyWeeks, monthWeek: rule.monthWeek } : null;
};
/** A series' skipped dates from today on, soonest first (Restore puts them back). */
const skippedFrom = (series: ScheduleSeries | null, today: string) => (series?.skipDates ?? []).filter((date) => date >= today).sort();
export type CalendarForm = ReturnType<typeof formValues>;

/**
 * Staff calendar: every gathering, school day and tour on one month grid.
 * ?m=YYYY-MM month; ?new=YYYY-MM-DD (&type=) opens the add sheet for that day;
 * ?item=event:<id> or tour:<id> opens that item's sheet.
 */
export async function loadCalendar(Astro: AstroGlobal) {
	const csrf = csrfToken(Astro.cookies, Astro.url.protocol === 'https:');
	const params = Astro.url.searchParams;
	const today = chicagoToday();
	const month = /^\d{4}-\d{2}$/.test(params.get('m') || '') ? params.get('m')! : today.slice(0, 7);
	const back = (date: string) => `/admin/calendar?m=${(date || today).slice(0, 7)}`;
	const { result, draft, draftAudience } = await calendarActions(Astro, {
		saved: (date) => `${back(date)}&saved=1`,
		deleted: (date) => `${back(date)}&deleted=1`,
	});
	if ('redirect' in result) return Astro.redirect(result.redirect, result.status);

	const [items, signups] = await Promise.all([listCalendar(), listSignups()]);
	const needReply = signups.filter((row) => row.kind === 'request' && ['new', 'contacted'].includes(row.status)).length;
	const typeFilter = CALENDAR_TYPES.some((item) => item.value === params.get('type')) && !params.get('new') ? params.get('type') as CalendarType : '';
	const audienceFilter = AUDIENCES.some((item) => item.value === params.get('audience')) ? params.get('audience')! : '';
	const shown = items.filter((item) => (!typeFilter || item.type === typeFilter) && (!audienceFilter || item.audience.includes(audienceFilter as never)));
	const byDay = new Map<string, CalendarItem[]>();
	for (const item of shown) byDay.set(item.date, [...(byDay.get(item.date) ?? []), item]);

	const newDate = /^\d{4}-\d{2}-\d{2}$/.test(params.get('new') || '') ? params.get('new')! : '';
	const editing = items.find((item) => item.key === params.get('item')) ?? null;
	const sheetType: CalendarType = editing ? editing.type : (CALENDAR_TYPES.some((item) => item.value === params.get('type')) ? params.get('type') as CalendarType : 'gathering');
	const series = await seriesFor(editing);
	if (series && editing?.source === 'tour') { editing.start = series.start.slice(0, 5); editing.end = series.end.slice(0, 5); editing.capacity = series.capacity; editing.published = series.published; }
	const form = formValues(editing, sheetType, newDate, draft, draftAudience, series);
	const people = editing && editing.signup !== 'none' ? await calendarPeople(editing) : [];
	const link = (changes: Record<string, string>) => {
		const url = new URL(Astro.url);
		for (const key of ['new', 'item', 'saved', 'deleted', 'edit']) if (!(key in changes)) url.searchParams.delete(key);
		for (const [key, value] of Object.entries(changes)) value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
		return url.pathname + url.search;
	};
	return {
		csrf, error: result.error, today, month, byDay, shown, items, link, typeFilter, audienceFilter,
		sheetOpen: !!newDate || !!editing, newDate, editing, sheetType, form, people, needReply, skipped: skippedFrom(series, today),
		// An item opens read-only; Edit (or a failed save) shows the form.
		// A requested tour is one family's booking: it's cancelled, never edited like an open time.
		viewing: !!editing && (editing.type === 'private_tour' || params.get('edit') !== '1') && !result.error,
		toast: toastFrom(Astro.url, { saved: 'Saved to the calendar.', deleted: 'Removed from the calendar.' }),
	};
}

/** One item's full page: its details to edit and everyone who signed up. */
export async function loadCalendarItem(Astro: AstroGlobal) {
	const csrf = csrfToken(Astro.cookies, Astro.url.protocol === 'https:');
	const key = keyFromPath(String(Astro.params.key ?? ''));
	const { result, draft, draftAudience } = await calendarActions(Astro, {
		saved: (_date, savedKey) => `${itemPath(savedKey)}?saved=1`,
		deleted: (date) => `/admin/calendar?m=${(date || chicagoToday()).slice(0, 7)}&deleted=1`,
	});
	if ('redirect' in result) return Astro.redirect(result.redirect, result.status);
	const item = (await listCalendar()).find((entry) => entry.key === key) ?? null;
	if (!item) return null;
	const series = await seriesFor(item);
	const form = formValues(item, item.type, '', draft, draftAudience, series);
	const people = item.signup !== 'none' ? await calendarPeople(item) : [];
	return { csrf, error: result.error, item, form, people, skipped: skippedFrom(series, chicagoToday()), toast: toastFrom(Astro.url, { saved: 'Saved.' }) };
}
