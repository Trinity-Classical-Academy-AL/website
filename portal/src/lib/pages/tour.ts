import type { AstroGlobal } from 'astro';
import { runActions, redirectOnSuccess, toastFrom } from '../actions.ts';
import { csrfToken, rememberTour } from '../security.ts';
import { parseUsDate } from '../fields.ts';
import { acceptProposedHold, cancelTourHold, familyTourView, requestOtherTourTime, saveSlotBooking } from '@tca/school';

/** Load data, run the existing actions, then derive the page's render model. */
export async function loadTour(Astro: AstroGlobal) {
	const secure = Astro.url.protocol === 'https:';
	const family = Astro.locals.family;
	if (!family) rememberTour(Astro.cookies, secure);
	const csrf = csrfToken(Astro.cookies, secure);
	let error = '';
	let saved = Astro.url.searchParams.get('saved') === '1';
	let showOther = Astro.url.searchParams.get('other') === '1';
	let view = family ? await familyTourView(family.id) : { slots: [], holds: [], summary: null };
	const actionResult = family ? await runActions(Astro, {
		cancel: async (form) => {
			await cancelTourHold(String(form.get('id') ?? ''), family.id);
			return { redirect: '/tour?cancelled=1' };
		},
		accept: async (form) => redirectOnSuccess(await acceptProposedHold(String(form.get('id') ?? ''), family.id), '/tour?saved=1'),
		other: async (form) => {
			const days = form.getAll('days').map(String);
			const dayParts = form.getAll('dayParts').map(String);
			if (days.length === 0 && dayParts.length === 0) return { error: 'Choose a time to continue.' };
			return redirectOnSuccess(await requestOtherTourTime({
				familyId: family.id, familyName: family.name || family.email, email: family.email, phone: family.phone,
				otherTime: '', grades: [], note: String(form.get('note') ?? ''), days, dayParts,
				earliest: parseUsDate(String(form.get('earliest') ?? '')), headCount: Number(form.get('people') || 1),
			}), '/tour?requested=1');
		},
	}, {
		draftFrom: (form) => { showOther = String(form.get('action') ?? '') === 'other'; return form; },
		fallback: async (form) => {
			if (!String(form.get('slotId') ?? '')) return { error: 'Choose a time to continue.' };
			return redirectOnSuccess(await saveSlotBooking({
				familyId: family.id, familyName: family.name || family.email, email: family.email, phone: family.phone,
				slotId: String(form.get('slotId') ?? ''), grades: [], note: String(form.get('note') ?? ''), headCount: Number(form.get('people') || 1),
			}), '/tour?saved=1');
		},
	}) : null;
	if (actionResult && 'redirect' in actionResult) return Astro.redirect(actionResult.redirect, actionResult.status);
	if (family && actionResult?.draft) {
		error = actionResult.error;
		saved = false;
		view = await familyTourView(family.id);
	}
	const slotHold = view.holds.find((hold) => hold.kind === 'slot');
	// Full times are never offered; a family's own booked time stays so they can see it.
	const openSlots = view.slots.filter((slot) => !slot.unavailable);
	const sent = saved;
	const cancelId = Astro.url.searchParams.get('cancel') || '';
	const cancelling = view.holds.find((hold) => hold.id === cancelId);
	const requestedToast = toastFrom(Astro.url, { requested: 'Request sent.' });
	const cancelledToast = toastFrom(Astro.url, { cancelled: 'Tour cancelled.' });
	return { family, csrf, error, showOther, view, openSlots, slotHold, sent, cancelling, requestedToast, cancelledToast };
}

export type TourView = Exclude<Awaited<ReturnType<typeof loadTour>>, Response>;
