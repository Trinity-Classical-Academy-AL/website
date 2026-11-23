import type { AstroGlobal } from 'astro';
import { runActions, toastFrom } from '../actions.ts';
import { csrfToken } from '../security.ts';
import {
	AUDIENCES, CALENDAR_TYPES, TYPE_DEFAULTS, addTourSlot, calendarPeople, chicagoToday, deleteEvent, deleteTourSeries, deleteTourSlot, skipTourSeriesDate, listCalendar, listSeries, listSignups, saveCalendarEvent, saveFlyerBytes, saveSeries, updateTourSlot,
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
			const saved = await saveCalendarEvent({
				id: read('id') || undefined, type: read('type'), title: read('title'), date: read('date'), start: read('start'), end: read('end'),
				allDay: form.get('allDay') === 'on', audience: form.getAll('audience').map(String), rsvp: form.get('rsvp') === 'on',
				capacity: read('capacity'), location: read('location'), description: read('description'), showPopup: form.get('popup') === 'on', imageKey,
			});
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
			if (repeats && repeats !== 'once') {
				// A repeating tour: one schedule that puts a tour on each matching date between two dates.
				const window = read('window');
				const pattern = repeats === 'weekdays' ? { weekdays: [1, 2, 3, 4, 5], everyWeeks: 1, monthWeek: null }
					: repeats === 'monthly' ? { weekdays: [Number(read('monthDay'))], everyWeeks: 1, monthWeek: Number(read('monthWeek')) }
					: { weekdays: form.getAll('weekdays').map(Number), everyWeeks: repeats === '3weeks' ? 3 : repeats === '2weeks' ? 2 : 1, monthWeek: null };
				const saved = await saveSeries({ id: read('seriesId') || undefined, ...input, ...pattern, startsOn: read('startsOn'), endsOn: read('endsOn'),
					bookingWindowDays: window === '' ? null : Number(window) });
				return saved.ok ? { redirect: read('id') ? after.saved(read('startsOn'), `tour:${read('id')}`) : after.saved(read('startsOn'), '') } : { error: saved.error };
			}
			const saved = read('id') ? await updateTourSlot({ id: read('id'), ...input }) : await addTourSlot(input);
			const id = read('id') || ('id' in saved ? String(saved.id) : '');
			return saved.ok ? { redirect: after.saved(read('date'), `tour:${id}`) } : { error: saved.error };
		},
		'delete-event': async (form) => {
			await deleteEvent(String(form.get('id') ?? ''));
			return { redirect: after.deleted(String(form.get('date') ?? '')) };
		},
		'delete-series': async (form) => {
			const removed = await deleteTourSeries(String(form.get('seriesId') ?? ''));
			return removed.ok ? { redirect: after.deleted(String(form.get('date') ?? '')) } : { error: removed.error ?? 'Couldn’t delete those dates.' };
		},
		'restore-date': async (form) => {
			// Puts a skipped date of a repeating tour back on the schedule.
			const date = String(form.get('date') ?? '');
			const restored = await skipTourSeriesDate(String(form.get('seriesId') ?? ''), date, true);
			return restored.ok ? { redirect: after.saved(date, String(form.get('item') ?? '')) } : { error: restored.error ?? 'Couldn’t restore that date.' };
		},
		'delete-tour': async (form) => {
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
		repeats: d?.repeats ?? (series ? repeatsOf(series) : 'once'), seriesId: series?.id ?? '',
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
const seriesFor = async (item: CalendarItem | null) => item?.seriesId ? (await listSeries()).find((series) => series.id === item.seriesId) ?? null : null;
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
	if (series) { editing!.start = series.start.slice(0, 5); editing!.end = series.end.slice(0, 5); editing!.capacity = series.capacity; editing!.published = series.published; }
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
		viewing: !!editing && params.get('edit') !== '1' && !result.error,
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
