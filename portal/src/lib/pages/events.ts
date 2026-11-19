import type { AstroGlobal } from 'astro';
import { runActions, toastFrom, fieldErrorMessage } from '../actions.ts';
import { csrfToken } from '../security.ts';
import { parseClock, parseUsDate } from '../fields.ts';
import { chicagoInputToIso, eventRsvpTotals, eventRsvps, deleteEvent, listEvents, saveEvent, saveFlyerBytes } from '@tca/school';

/** Load data, run the existing actions, then derive the page's render model. */
export async function loadEvents(Astro: AstroGlobal, family: NonNullable<AstroGlobal['locals']['family']>) {
	const secure = Astro.url.protocol === 'https:';
	const csrf = csrfToken(Astro.cookies, secure);
	const past = Astro.url.searchParams.get('tab') === 'past';
	let error = '';
	let fields: Record<string, string> = {};
	const actionResult = await runActions(Astro, {
		delete: async (form) => {
			await deleteEvent(String(form.get('id') ?? ''));
			return { redirect: '/admin/events?removed=1' };
		},
	}, {
		fallback: async (form) => {
			const title = String(form.get('title') ?? '').trim();
			const date = parseUsDate(String(form.get('date') ?? ''));
			const start = parseClock(String(form.get('start') ?? ''));
			const end = parseClock(String(form.get('end') ?? ''));
			if (!title) fields.title = 'Add a title.';
			if (!date) fields.date = 'Enter a date.';
			if (start && end && start >= end) fields.end = 'End must be after start.';
			const count = Object.keys(fields).length;
			if (count) error = fieldErrorMessage(count, { plural: true });
			else {
				const file = form.get('flyer');
				let flyerKey = '';
				let flyerName = '';
				if (file instanceof File && file.size) {
					if (file.size > 10 * 1024 * 1024) error = 'Files must be 10 MB or smaller.';
					else {
						const saved = await saveFlyerBytes(new Uint8Array(await file.arrayBuffer()), { name: file.name, contentType: file.type || 'image/jpeg' });
						flyerKey = saved.key;
						flyerName = saved.name;
					}
				}
				if (!error) {
					const startsAt = chicagoInputToIso(`${date}T${start || '09:00'}`);
					const id = await saveEvent({
						id: String(form.get('id') ?? '') || undefined,
						title,
						description: String(form.get('description') ?? ''),
						startsAt,
						endsAt: end ? chicagoInputToIso(`${date}T${end}`) : undefined,
						location: String(form.get('location') ?? ''),
						showOnWebsite: form.get('website') === 'on',
						featurePopup: form.get('popup') === 'on',
						collectRsvp: form.get('rsvp') === 'on',
						rsvpUrl: String(form.get('rsvpUrl') ?? ''),
						flyerKey,
						flyerName,
					});
					return { redirect: `/admin/events?saved=${id}` };
				}
			}
			return { error, fields };
		},
	});
	
	if ('redirect' in actionResult) return Astro.redirect(actionResult.redirect, actionResult.status);
	error = actionResult.error;
	fields = actionResult.fields;
	const totals = await eventRsvpTotals();
	const now = Date.now();
	const allEvents = await listEvents();
	const events = allEvents.filter((event) => past ? new Date(event.startsAt).getTime() < now : new Date(event.startsAt).getTime() >= now - 3600_000);
	const editing = allEvents.find((event) => event.id === Astro.url.searchParams.get('event'));
	const guests = editing ? await eventRsvps(editing.id) : [];
	const adding = Astro.url.searchParams.get('sheet') === 'new' || Boolean(error);
	const saved = allEvents.find((event) => event.id === Astro.url.searchParams.get('saved'));
	const toast = toastFrom(Astro.url, { saved: () => saved ? `${saved.title} saved${saved.showOnWebsite ? ' and shown on the website.' : '.'}` : '' });
	return { csrf, past, error, fields, totals, events, editing, guests, adding, saved, toast };
}

export type EventsView = Exclude<Awaited<ReturnType<typeof loadEvents>>, Response>;
