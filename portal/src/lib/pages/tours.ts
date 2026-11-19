import type { AstroGlobal } from 'astro';

import { runActions, redirectOnSuccess, toastFrom, fieldErrorMessage } from '../actions.ts';
import { csrfToken } from '../security.ts';
import { parseClock, parseUsDate } from '../fields.ts';
import { TOUR_STATUSES, addTourSlot, deleteTourSeries, listSeries, saveSeries, skipTourSeriesDate, declineTourRequest, deleteTourSlot, formatTourClock, listAdminTours, listTourSlotSummary, replyToTourRequest, updateTourSlot } from '@tca/school';

/** Load data, run the existing actions, then derive the page's render model. */
export async function loadTours(Astro: AstroGlobal, family: NonNullable<AstroGlobal['locals']['family']>) {
	const secure = Astro.url.protocol === 'https:';
	const csrf = csrfToken(Astro.cookies, secure);
	const requested = Astro.url.searchParams.get('tab');
	let tab = requested === 'requests' || requested === 'bookings' ? requested : 'times';
	let error = '';
	let fields: Record<string, string> = {};
	let draft = { type: 'tour', date: '', start: '9:00 AM', end: '10:00 AM', capacity: '1', capacityUnit: 'families', repeats: 'none', weekdays: [] as number[], startsOn: '', endsOn: '', bookingWindowDays: '92', published: true, message: '', mode: String(TOUR_STATUSES.CONFIRMED) };
	const actionResult = await runActions(Astro, {
		slot: async (form) => {
			if (draft.repeats === 'weekly') {
				return redirectOnSuccess(await saveSeries({ id: String(form.get('seriesId') || '') || undefined, type: draft.type, weekdays: draft.weekdays,
					startsOn: parseUsDate(draft.startsOn), endsOn: parseUsDate(draft.endsOn), start: parseClock(draft.start), end: parseClock(draft.end),
					capacity: Number(draft.capacity), capacityUnit: draft.capacityUnit === 'people' ? 'people' : 'families', published: draft.published, bookingWindowDays: draft.bookingWindowDays === '' ? null : Number(draft.bookingWindowDays) }), result => `/admin/tours?saved=${result.id}`);
			}
			const date = parseUsDate(draft.date);
			const start = parseClock(draft.start);
			const end = parseClock(draft.end);
			const capacity = Number(draft.capacity);
			const fields: Record<string, string> = {};
			if (!date) fields.date = 'Enter a date.';
			if (!start || !end || start >= end) fields.end = 'End must be after start.';
			if (!Number.isInteger(capacity) || capacity < 1) fields.capacity = 'Capacity must be at least 1.';
			if (Object.keys(fields).length) return { error: fieldErrorMessage(fields), fields };
			const id = String(form.get('id') ?? '');
			const input = { date, start, end, capacity, capacityUnit: draft.capacityUnit === 'people' ? 'people' as const : 'families' as const, type: draft.type, published: draft.published };
			if (id) return redirectOnSuccess(await updateTourSlot({ id, ...input }), `/admin/tours?saved=${id}`);
			return redirectOnSuccess(await addTourSlot(input), result => `/admin/tours?saved=${result.id}`);
		},
		'rule-delete': async (form) => redirectOnSuccess(await deleteTourSeries(String(form.get('id') ?? '')), '/admin/tours?removed=1'),
		skip: changeSeriesDate,
		restore: changeSeriesDate,
		delete: async (form) => redirectOnSuccess(await deleteTourSlot(String(form.get('id') ?? '')), '/admin/tours?removed=1'),
		reply: async (form) => redirectOnSuccess(await replyToTourRequest({
			id: String(form.get('id') ?? ''), date: parseUsDate(draft.date), start: parseClock(draft.start), end: parseClock(draft.end),
			mode: draft.mode === TOUR_STATUSES.PROPOSED ? TOUR_STATUSES.PROPOSED : TOUR_STATUSES.CONFIRMED, message: draft.message,
		}), '/admin/tours?tab=requests&sent=1'),
		decline: async (form) => {
			await declineTourRequest(String(form.get('id') ?? ''));
			return { redirect: '/admin/tours?tab=requests&declined=1' };
		},
	}, {
		draftFrom: (form) => {
			const posted = String(form.get('tab') ?? '');
			if (posted === 'requests' || posted === 'bookings' || posted === 'times') tab = posted;
			draft = {
				type: String(form.get('type') ?? 'tour'), date: String(form.get('date') ?? ''), start: String(form.get('start') ?? ''), end: String(form.get('end') ?? ''),
				capacity: String(form.get('capacity') ?? '1'), capacityUnit: String(form.get('capacityUnit') ?? 'families'), repeats: String(form.get('repeats') ?? 'none'),
				weekdays: form.getAll('weekdays').map(Number), startsOn: String(form.get('startsOn') ?? ''), endsOn: String(form.get('endsOn') ?? ''),
				bookingWindowDays: String(form.get('bookingWindowDays') ?? '92'), published: form.get('published') === 'on', message: String(form.get('message') ?? ''), mode: String(form.get('mode') ?? TOUR_STATUSES.CONFIRMED),
			};
			return draft;
		},
	});
	async function changeSeriesDate(form: FormData, { action }: { action: string }) {
		const id = String(form.get('id') ?? '');
		return redirectOnSuccess(await skipTourSeriesDate(id, String(form.get('skipDate') ?? ''), action === 'restore'), `/admin/tours?rule=${id}`);
	}
	
	if ('redirect' in actionResult) return Astro.redirect(actionResult.redirect, actionResult.status);
	error = actionResult.error;
	fields = actionResult.fields;
	const [slots, rows, allSeries] = await Promise.all([listTourSlotSummary(), listAdminTours(), listSeries()]);
	const rules = allSeries.filter(series => ['tour', 'open_house', 'info_night'].includes(series.type));
	const oneOffs = slots.filter(slot => !slot.seriesId);
	const requests = rows.filter((row) => row.kind === 'other' && row.status !== TOUR_STATUSES.CANCELLED && row.status !== TOUR_STATUSES.CONFIRMED);
	const bookings = rows.filter((row) => row.kind === 'slot' && row.status !== TOUR_STATUSES.CANCELLED);
	const seriesId = Astro.url.searchParams.get('rule') || '';
	const editingRule = rules.find(rule => rule.id === seriesId);
	const editingId = seriesId || Astro.url.searchParams.get('slot') || '';
	const adding = Astro.url.searchParams.get('sheet') === 'add' || (error && tab === 'times' && !editingId);
	const editing = editingRule ? { ...editingRule, date: editingRule.startsOn, taken: editingRule.families } : slots.find((slot) => slot.id === editingId);
	const editHref = editingRule ? `/admin/tours?rule=${editingId}` : `/admin/tours?slot=${editingId}`;
	const skipDate = Astro.url.searchParams.get('skip') || '';
	const skipSlot = slots.find(slot => slot.seriesId === seriesId && slot.date === skipDate);
	const skipFamilies = skipSlot?.families ?? 0;
	const confirmingSkip = Boolean(editingRule && skipDate && Astro.url.searchParams.get('confirm') === skipDate);
	const repeats = error ? draft.repeats : editingRule ? 'weekly' : 'none';
	const selectedDays = error ? draft.weekdays : editingRule?.weekdays ?? [];
	const confirmingDelete = Astro.url.searchParams.get('confirm') === editingId && Boolean(editing);
	const replying = requests.find((row) => row.id === (Astro.url.searchParams.get('reply') || ''));
	const savedId = Astro.url.searchParams.get('saved') || '';
	const toast = toastFrom(Astro.url, { saved: 'Time saved.', removed: 'Time deleted.', sent: 'Reply sent.', declined: 'Request declined.' });
	const query = (Astro.url.searchParams.get('q') || '').trim().toLowerCase();
	const whenFilter = Astro.url.searchParams.get('when') || '';
	const visibleBookings = bookings.filter((row) => {
		if (whenFilter && row.slotId !== whenFilter) return false;
		if (!query) return true;
		return `${row.familyName} ${row.email} ${row.note}`.toLowerCase().includes(query);
	});
	const groups = new Map<string, typeof visibleBookings>();
	for (const row of visibleBookings) {
		const key = row.slotId || row.when;
		groups.set(key, [...(groups.get(key) ?? []), row]);
	}
	const clock = (start: string, end: string) => `${formatTourClock(start)} to ${formatTourClock(end)}`;
	const openHref = (slotId: string) => `/admin/tours?slot=${slotId}`;
	return { family, csrf, tab, error, fields, draft, slots, rows, rules, oneOffs, requests, bookings, seriesId, editingRule, adding, editing, editHref, skipDate, skipFamilies, confirmingSkip, repeats, selectedDays, confirmingDelete, replying, savedId, toast, query, whenFilter, groups, clock, openHref };
}

export type ToursView = Exclude<Awaited<ReturnType<typeof loadTours>>, Response>;
