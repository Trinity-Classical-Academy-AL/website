import type { AstroGlobal } from 'astro';
import { runActions, toastFrom } from '../actions.ts';
import { csrfToken } from '../security.ts';
import { AUDIENCES, CALENDAR_TYPES, TYPE_DEFAULTS, addTourSlot, chicagoToday, deleteEvent, listCalendar, saveCalendarEvent, type CalendarItem, type CalendarType } from '@tca/school';

/**
 * Staff calendar: every gathering, school day and tour on one month grid.
 * ?m=YYYY-MM month; ?new=YYYY-MM-DD (&type=) opens the add sheet for that day;
 * ?item=event:<id> edits a gathering or school day. Tours open their own editor.
 */
export async function loadCalendar(Astro: AstroGlobal) {
	const csrf = csrfToken(Astro.cookies, Astro.url.protocol === 'https:');
	const params = Astro.url.searchParams;
	const today = chicagoToday();
	const month = /^\d{4}-\d{2}$/.test(params.get('m') || '') ? params.get('m')! : today.slice(0, 7);
	const back = (date: string) => `/admin/calendar?m=${date.slice(0, 7)}`;
	let draft: Record<string, string> | null = null;
	let draftAudience: string[] | null = null;
	const result = await runActions(Astro, {
		'save-event': async (form) => {
			const read = (key: string) => String(form.get(key) ?? '');
			draft = Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)]));
			draftAudience = form.getAll('audience').map(String);
			const saved = await saveCalendarEvent({
				id: read('id') || undefined, type: read('type'), title: read('title'), date: read('date'), start: read('start'), end: read('end'),
				allDay: form.get('allDay') === 'on', audience: form.getAll('audience').map(String), rsvp: form.get('rsvp') === 'on',
				capacity: read('capacity'), location: read('location'), description: read('description'), showPopup: form.get('popup') === 'on',
			});
			return saved.ok ? { redirect: `${back(read('date'))}&saved=1` } : { error: saved.error };
		},
		'save-tour': async (form) => {
			const read = (key: string) => String(form.get(key) ?? '');
			draft = Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)]));
			const saved = await addTourSlot({
				date: read('date'), start: read('start'), end: read('end'), capacity: Number(read('capacity')), type: 'tour',
				published: form.get('published') === 'on', capacityUnit: read('unit') === 'people' ? 'people' : 'families',
			});
			return saved.ok ? { redirect: `${back(read('date'))}&saved=1` } : { error: saved.error };
		},
		'delete-event': async (form) => {
			await deleteEvent(String(form.get('id') ?? ''));
			return { redirect: `${back(String(form.get('date') ?? today))}&deleted=1` };
		},
	});
	if ('redirect' in result) return Astro.redirect(result.redirect, result.status);

	const items = await listCalendar();
	const typeFilter = CALENDAR_TYPES.some((item) => item.value === params.get('type')) && !params.get('new') ? params.get('type') as CalendarType : '';
	const audienceFilter = AUDIENCES.some((item) => item.value === params.get('audience')) ? params.get('audience')! : '';
	const shown = items.filter((item) => (!typeFilter || item.type === typeFilter) && (!audienceFilter || item.audience.includes(audienceFilter as never)));
	const byDay = new Map<string, CalendarItem[]>();
	for (const item of shown) byDay.set(item.date, [...(byDay.get(item.date) ?? []), item]);

	const newDate = /^\d{4}-\d{2}-\d{2}$/.test(params.get('new') || '') ? params.get('new')! : '';
	const editing = items.find((item) => item.key === params.get('item') && item.source === 'event') ?? null;
	const sheetType: CalendarType = editing ? editing.type : (CALENDAR_TYPES.some((item) => item.value === params.get('type')) ? params.get('type') as CalendarType : 'gathering');
	const defaults = TYPE_DEFAULTS[sheetType];
	// The form's starting values: what was typed (after an error), the item being edited, or the type's defaults.
	const d = draft as Record<string, string> | null;
	const form = {
		id: editing?.id ?? '', title: d?.title ?? editing?.title ?? (sheetType === 'school_day' ? 'No school' : ''),
		date: d?.date ?? editing?.date ?? newDate, start: d?.start ?? editing?.start ?? (sheetType === 'tour' ? '09:00' : '18:00'), end: d?.end ?? editing?.end ?? (sheetType === 'tour' ? '10:00' : '19:30'),
		allDay: d ? d.allDay === 'on' : editing?.allDay ?? defaults.allDay,
		audience: (draftAudience as string[] | null) ?? editing?.audience ?? defaults.audience,
		rsvp: d ? d.rsvp === 'on' : editing ? editing.signup === 'rsvp' : defaults.signup === 'rsvp',
		capacity: d?.capacity ?? (editing?.capacity ? String(editing.capacity) : sheetType === 'tour' ? '6' : ''),
		location: d?.location ?? editing?.location ?? '', description: d?.description ?? editing?.description ?? '', popup: editing?.showPopup ?? false,
	};
	const link = (changes: Record<string, string>) => {
		const url = new URL(Astro.url);
		for (const key of ['new', 'item', 'saved', 'deleted']) if (!(key in changes)) url.searchParams.delete(key);
		for (const [key, value] of Object.entries(changes)) value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
		return url.pathname + url.search;
	};
	const sheetOpen = !!newDate || !!editing;
	return {
		csrf, error: result.error, today, month, byDay, shown, items, link, typeFilter, audienceFilter,
		sheetOpen, newDate, editing, sheetType, form,
		toast: toastFrom(Astro.url, { saved: 'Saved to the calendar.', deleted: 'Removed from the calendar.' }),
	};
}

export type CalendarView = Exclude<Awaited<ReturnType<typeof loadCalendar>>, Response>;
