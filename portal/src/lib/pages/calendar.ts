import type { AstroGlobal } from 'astro';
import { runActions, toastFrom } from '../actions.ts';
import { csrfToken } from '../security.ts';
import {
	AUDIENCES, CALENDAR_TYPES, TYPE_DEFAULTS, addTourSlot, calendarPeople, chicagoToday, deleteEvent, deleteTourSlot, listCalendar, saveCalendarEvent, updateTourSlot,
	type CalendarItem, type CalendarType,
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
	};
	const result = await runActions(Astro, {
		'save-event': async (form) => {
			const read = (key: string) => String(form.get(key) ?? '');
			remember(form);
			const saved = await saveCalendarEvent({
				id: read('id') || undefined, type: read('type'), title: read('title'), date: read('date'), start: read('start'), end: read('end'),
				allDay: form.get('allDay') === 'on', audience: form.getAll('audience').map(String), rsvp: form.get('rsvp') === 'on',
				capacity: read('capacity'), location: read('location'), description: read('description'), showPopup: form.get('popup') === 'on',
			});
			return saved.ok ? { redirect: after.saved(read('date'), `event:${saved.id}`) } : { error: saved.error };
		},
		'save-tour': async (form) => {
			const read = (key: string) => String(form.get(key) ?? '');
			remember(form);
			const input = {
				date: read('date'), start: read('start'), end: read('end'), capacity: Number(read('capacity')), type: 'tour',
				published: form.get('published') === 'on', capacityUnit: (read('unit') === 'people' ? 'people' : 'families') as 'people' | 'families',
			};
			const saved = read('id') ? await updateTourSlot({ id: read('id'), ...input }) : await addTourSlot(input);
			const id = read('id') || ('id' in saved ? String(saved.id) : '');
			return saved.ok ? { redirect: after.saved(read('date'), `tour:${id}`) } : { error: saved.error };
		},
		'delete-event': async (form) => {
			await deleteEvent(String(form.get('id') ?? ''));
			return { redirect: after.deleted(String(form.get('date') ?? '')) };
		},
		'delete-tour': async (form) => {
			const removed = await deleteTourSlot(String(form.get('id') ?? ''));
			return removed.ok ? { redirect: after.deleted(String(form.get('date') ?? '')) } : { error: removed.error };
		},
	});
	return { result, draft: draft as Record<string, string> | null, draftAudience: draftAudience as string[] | null };
}

function formValues(editing: CalendarItem | null, sheetType: CalendarType, newDate: string, d: Record<string, string> | null, draftAudience: string[] | null) {
	const defaults = TYPE_DEFAULTS[sheetType];
	const tour = sheetType === 'tour';
	return {
		id: editing?.id ?? '', title: d?.title ?? editing?.title ?? (sheetType === 'school_day' ? 'No school' : ''),
		date: d?.date ?? editing?.date ?? newDate,
		start: d?.start ?? editing?.start ?? (tour ? '09:00' : '18:00'), end: d?.end ?? editing?.end ?? (tour ? '10:00' : '19:30'),
		allDay: d ? d.allDay === 'on' : editing?.allDay ?? defaults.allDay,
		audience: draftAudience ?? editing?.audience ?? defaults.audience,
		rsvp: d ? d.rsvp === 'on' : editing ? editing.signup === 'rsvp' : defaults.signup === 'rsvp',
		capacity: d?.capacity ?? (editing?.capacity ? String(editing.capacity) : tour ? '6' : ''),
		unit: d?.unit ?? editing?.capacityUnit ?? 'families',
		published: d ? d.published === 'on' : editing?.published ?? true,
		location: d?.location ?? editing?.location ?? '', description: d?.description ?? editing?.description ?? '', popup: editing?.showPopup ?? false,
	};
}
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

	const items = await listCalendar();
	const typeFilter = CALENDAR_TYPES.some((item) => item.value === params.get('type')) && !params.get('new') ? params.get('type') as CalendarType : '';
	const audienceFilter = AUDIENCES.some((item) => item.value === params.get('audience')) ? params.get('audience')! : '';
	const shown = items.filter((item) => (!typeFilter || item.type === typeFilter) && (!audienceFilter || item.audience.includes(audienceFilter as never)));
	const byDay = new Map<string, CalendarItem[]>();
	for (const item of shown) byDay.set(item.date, [...(byDay.get(item.date) ?? []), item]);

	const newDate = /^\d{4}-\d{2}-\d{2}$/.test(params.get('new') || '') ? params.get('new')! : '';
	const editing = items.find((item) => item.key === params.get('item')) ?? null;
	const sheetType: CalendarType = editing ? editing.type : (CALENDAR_TYPES.some((item) => item.value === params.get('type')) ? params.get('type') as CalendarType : 'gathering');
	const form = formValues(editing, sheetType, newDate, draft, draftAudience);
	const people = editing && editing.signup !== 'none' ? await calendarPeople(editing) : [];
	const link = (changes: Record<string, string>) => {
		const url = new URL(Astro.url);
		for (const key of ['new', 'item', 'saved', 'deleted']) if (!(key in changes)) url.searchParams.delete(key);
		for (const [key, value] of Object.entries(changes)) value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
		return url.pathname + url.search;
	};
	return {
		csrf, error: result.error, today, month, byDay, shown, items, link, typeFilter, audienceFilter,
		sheetOpen: !!newDate || !!editing, newDate, editing, sheetType, form, people,
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
	const form = formValues(item, item.type, '', draft, draftAudience);
	const people = item.signup !== 'none' ? await calendarPeople(item) : [];
	return { csrf, error: result.error, item, form, people, toast: toastFrom(Astro.url, { saved: 'Saved.' }) };
}
