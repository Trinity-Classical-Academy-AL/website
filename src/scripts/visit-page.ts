import { TOUR_DEFAULTS, TOUR_FIELD_ORDER } from '../lib/admissions/defaults.ts';
import { errorSummary, givenName, validateTourRequest } from '../lib/admissions/validation.ts';
import { capture } from './analytics.ts';

type PublicDate = {
	id: string;
	date: string;
	label: string;
	timeLabel: string;
	capacity: number;
	booked: number;
	remaining: number;
	full: boolean;
};

type Schedule = {
	dates: PublicDate[];
	schoolYear?: string;
	bookable?: number;
};

const FIXTURE_DATES: PublicDate[] = [
	{
		id: '2027-01-13',
		date: '2027-01-13',
		label: 'Wednesday, January 13, 2027',
		timeLabel: '9:00–10:00 AM',
		capacity: 12,
		booked: 3,
		remaining: 9,
		full: false,
	},
	{
		id: '2027-02-10',
		date: '2027-02-10',
		label: 'Wednesday, February 10, 2027',
		timeLabel: '9:00–10:00 AM',
		capacity: 12,
		booked: 12,
		remaining: 0,
		full: true,
	},
	{
		id: '2027-03-10',
		date: '2027-03-10',
		label: 'Wednesday, March 10, 2027',
		timeLabel: '9:00–10:00 AM',
		capacity: 12,
		booked: 0,
		remaining: 12,
		full: false,
	},
];

function previewEnabled(): boolean {
	return document.documentElement.dataset.previewStates === 'true';
}

function show(root: ParentNode, name: string) {
	root.querySelectorAll<HTMLElement>('[data-visit-view]').forEach((view) => {
		view.toggleAttribute('hidden', view.dataset.visitView !== name);
	});
}

function fieldElements(form: HTMLFormElement, name: string): HTMLElement[] {
	return [...form.querySelectorAll<HTMLElement>(`[data-field="${name}"]`)];
}

function clearErrors(form: HTMLFormElement) {
	const summary = form.querySelector<HTMLElement>('[data-error-summary]');
	if (summary) {
		summary.hidden = true;
		summary.textContent = '';
	}
	form.querySelectorAll<HTMLElement>('[data-error-for]').forEach((node) => {
		node.hidden = true;
		node.textContent = '';
	});
	form.querySelectorAll<HTMLElement>('[aria-invalid="true"]').forEach((node) => {
		node.setAttribute('aria-invalid', 'false');
	});
	const server = form.querySelector<HTMLElement>('[data-server-error]');
	if (server) server.hidden = true;
}

function applyErrors(form: HTMLFormElement, errors: Record<string, string>) {
	clearErrors(form);
	const names = Object.keys(errors);
	const summary = form.querySelector<HTMLElement>('[data-error-summary]');
	if (summary && names.length) {
		summary.hidden = false;
		summary.textContent = errorSummary(names.length);
	}
	for (const [name, message] of Object.entries(errors)) {
		const note = form.querySelector<HTMLElement>(`[data-error-for="${name}"]`);
		if (note) {
			note.hidden = false;
			note.textContent = message;
		}
		fieldElements(form, name).forEach((element) => element.setAttribute('aria-invalid', 'true'));
	}
	const first = TOUR_FIELD_ORDER.find((name) => errors[name]);
	if (!first) return;
	const target = fieldElements(form, first)[0];
	target?.focus();
}

function readGrades(form: HTMLFormElement): string[] {
	return [...form.querySelectorAll<HTMLButtonElement>('[data-grade][aria-pressed="true"]')].map(
		(button) => button.dataset.grade ?? '',
	);
}

function payloadFrom(form: HTMLFormElement): Record<string, unknown> {
	const data = new FormData(form);
	return {
		parentName: String(data.get('parentName') ?? ''),
		email: String(data.get('email') ?? ''),
		phone: String(data.get('phone') ?? ''),
		children: String(data.get('children') ?? ''),
		grades: readGrades(form),
		tourDateId: String(data.get('tourDateId') ?? ''),
		hearAbout: String(data.get('hearAbout') ?? ''),
		message: String(data.get('message') ?? ''),
		company: String(data.get('company') ?? ''),
	};
}

function renderDates(form: HTMLFormElement, dates: PublicDate[]) {
	const list = form.querySelector<HTMLElement>('[data-date-list]');
	if (!list) return;
	list.replaceChildren();
	dates.forEach((date) => {
		const label = document.createElement('label');
		label.className =
			'flex cursor-pointer items-center justify-between gap-4 rounded-card border border-ink/10 bg-white px-4 py-3 transition has-[:checked]:border-forest has-[:checked]:bg-[#e7f2e4] has-[:disabled]:cursor-not-allowed has-[:disabled]:bg-ink/[0.03] has-[:disabled]:opacity-70';
		const input = document.createElement('input');
		input.type = 'radio';
		input.name = 'tourDateId';
		input.value = date.id;
		input.className = 'mt-0.5 h-4 w-4 shrink-0 accent-forest';
		input.disabled = date.full;
		input.dataset.field = 'tourDateId';
		if (date.full) input.dataset.full = 'true';
		const copy = document.createElement('span');
		copy.className = 'min-w-0 flex-1';
		const title = document.createElement('span');
		title.className = 'block font-sans text-sm font-medium text-ink';
		title.textContent = date.label;
		const time = document.createElement('span');
		time.className = 'mt-0.5 block font-mono text-[10px] uppercase tracking-eyebrow text-ink-mute';
		time.textContent = date.timeLabel;
		copy.append(title, time);
		const spots = document.createElement('span');
		spots.className = `shrink-0 font-mono text-[10px] font-medium uppercase tracking-eyebrow ${date.full ? 'text-[#9f2d2d]' : 'text-forest'}`;
		spots.textContent = date.full ? 'Full' : date.remaining === 1 ? '1 spot left' : `${date.remaining} spots left`;
		label.append(input, copy, spots);
		list.append(label);
	});
}

function setBusy(form: HTMLFormElement, busy: boolean) {
	form.setAttribute('aria-busy', busy ? 'true' : 'false');
	const button = form.querySelector<HTMLButtonElement>('[data-submit]');
	if (button) {
		button.disabled = busy;
		button.textContent = busy ? 'Sending…' : 'Request this tour';
	}
	form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>(
		'input, select, textarea, button[data-grade]',
	).forEach((element) => {
		if (element === button) return;
		if (busy) {
			element.disabled = true;
			return;
		}
		element.disabled = element.dataset.full === 'true';
	});
	const status = form.querySelector<HTMLElement>('[data-status]');
	if (status) status.textContent = busy ? 'Sending your request.' : '';
}

function showSuccess(root: HTMLElement, result: { givenName: string; email: string; dateLabel: string; timeLabel: string }) {
	const name = root.querySelector<HTMLElement>('[data-success-name]');
	const lead = root.querySelector<HTMLElement>('[data-success-lead]');
	const when = root.querySelector<HTMLElement>('[data-success-when]');
	const time = root.querySelector<HTMLElement>('[data-success-time]');
	if (name) name.textContent = result.givenName;
	if (lead) {
		lead.textContent = `${TOUR_DEFAULTS.confirmationMessage} We'll see you ${result.dateLabel}, ${result.timeLabel}.`;
	}
	if (when) when.textContent = result.dateLabel;
	if (time) time.textContent = result.timeLabel;
	show(root, 'success');
	const heading = root.querySelector<HTMLElement>('[data-success-heading]');
	heading?.focus();
}

function showServerError(form: HTMLFormElement, message: string) {
	const server = form.querySelector<HTMLElement>('[data-server-error]');
	if (!server) return;
	server.hidden = false;
	server.textContent = message;
	server.focus();
}

async function loadSchedule(): Promise<Schedule> {
	const response = await fetch('/api/tours', { headers: { accept: 'application/json' } });
	if (!response.ok) throw new Error('load failed');
	return (await response.json()) as Schedule;
}

function fillSample(form: HTMLFormElement) {
	const name = form.querySelector<HTMLInputElement>('[name="parentName"]');
	const email = form.querySelector<HTMLInputElement>('[name="email"]');
	const phone = form.querySelector<HTMLInputElement>('[name="phone"]');
	const children = form.querySelector<HTMLSelectElement>('[name="children"]');
	const message = form.querySelector<HTMLTextAreaElement>('[name="message"]');
	const heard = form.querySelector<HTMLSelectElement>('[name="hearAbout"]');
	if (name) name.value = 'Jordan Smith';
	if (email) email.value = 'jordan.smith@example.com';
	if (phone) phone.value = '(205) 555-0142';
	if (children) children.value = '2';
	if (heard) heard.value = 'friend';
	if (message) message.value = 'We are moving to Birmingham this summer and would love to see a class in session.';
	form.querySelectorAll<HTMLButtonElement>('[data-grade]').forEach((button) => {
		const on = button.dataset.grade === '2' || button.dataset.grade === 'K';
		button.setAttribute('aria-pressed', on ? 'true' : 'false');
	});
	const radio = form.querySelector<HTMLInputElement>('input[value="2027-01-13"]');
	if (radio) radio.checked = true;
}

export function initVisitPage() {
	const root = document.querySelector<HTMLElement>('[data-visit-page]');
	if (!root) return;
	const form = root.querySelector<HTMLFormElement>('[data-visit-form]');
	const followup = document.querySelector<HTMLElement>('[data-visit-followup]');
	if (!form) return;

	const yearNote = root.querySelector<HTMLElement>('[data-school-year]');
	const params = new URLSearchParams(location.search);
	const preview = previewEnabled() ? params.get('state') : null;

	const applySchedule = (schedule: Schedule, mode: 'form' | 'full' | 'empty') => {
		if (yearNote && schedule.schoolYear) yearNote.textContent = schedule.schoolYear;
		renderDates(form, schedule.dates);
		const fullList = root.querySelector<HTMLElement>('[data-full-list]');
		if (fullList) {
			fullList.replaceChildren();
			schedule.dates.forEach((date) => {
				const row = document.createElement('p');
				row.className = 'flex items-center justify-between gap-3 font-sans text-sm text-ink';
				const name = document.createElement('span');
				name.textContent = date.label;
				const badge = document.createElement('span');
				badge.className = 'font-mono text-[10px] uppercase tracking-eyebrow text-[#9f2d2d]';
				badge.textContent = 'Full';
				row.append(name, badge);
				fullList.append(row);
			});
		}
		if (followup) followup.hidden = mode === 'form';
		show(root, mode === 'form' ? 'form' : mode);
	};

	const boot = async () => {
		if (preview === 'server') {
			show(root, 'load-error');
			return;
		}
		if (preview === 'empty') {
			applySchedule({ dates: [], schoolYear: '2027–28' }, 'empty');
			return;
		}
		if (preview === 'full') {
			applySchedule(
				{
					schoolYear: '2027–28',
					dates: FIXTURE_DATES.map((date) => ({ ...date, remaining: 0, full: true, booked: date.capacity })),
				},
				'full',
			);
			return;
		}
		if (preview === 'default' || preview === 'errors' || preview === 'submitting' || preview === 'success' || preview === 'submit-error') {
			applySchedule({ dates: FIXTURE_DATES, schoolYear: '2027–28', bookable: 2 }, 'form');
			fillSample(form);
			if (preview === 'errors') {
				const name = form.querySelector<HTMLInputElement>('[name="parentName"]');
				const email = form.querySelector<HTMLInputElement>('[name="email"]');
				const phone = form.querySelector<HTMLInputElement>('[name="phone"]');
				if (name) name.value = '';
				if (email) email.value = 'jordan.smith@';
				if (phone) phone.value = '205-555';
				form.querySelectorAll<HTMLButtonElement>('[data-grade]').forEach((button) => button.setAttribute('aria-pressed', 'false'));
				form.querySelectorAll<HTMLInputElement>('input[name="tourDateId"]').forEach((input) => {
					input.checked = false;
				});
				applyErrors(form, validateTourRequest(payloadFrom(form)).errors);
			}
			if (preview === 'submitting') setBusy(form, true);
			if (preview === 'success') {
				showSuccess(root, {
					givenName: 'Jordan',
					email: 'jordan.smith@example.com',
					dateLabel: 'Wednesday, January 13, 2027',
					timeLabel: '9:00–10:00 AM',
				});
			}
			if (preview === 'submit-error') {
				showServerError(
					form,
					`We couldn't send that just now. Please try again, or email ${TOUR_DEFAULTS.schoolEmail}.`,
				);
			}
			return;
		}

		try {
			const schedule = await loadSchedule();
			if (yearNote && schedule.schoolYear) yearNote.textContent = schedule.schoolYear;
			if (schedule.dates.length === 0) {
				applySchedule(schedule, 'empty');
				return;
			}
			if ((schedule.bookable ?? schedule.dates.filter((date) => !date.full).length) === 0) {
				applySchedule(schedule, 'full');
				return;
			}
			applySchedule(schedule, 'form');
		} catch {
			show(root, 'load-error');
		}
	};

	form.querySelectorAll<HTMLButtonElement>('[data-grade]').forEach((button) => {
		button.addEventListener('click', () => {
			const pressed = button.getAttribute('aria-pressed') === 'true';
			button.setAttribute('aria-pressed', pressed ? 'false' : 'true');
		});
	});

	root.querySelector('[data-retry]')?.addEventListener('click', () => {
		show(root, 'loading');
		void boot();
	});

	root.querySelector('[data-another]')?.addEventListener('click', () => {
		form.reset();
		form.querySelectorAll<HTMLButtonElement>('[data-grade]').forEach((button) => button.setAttribute('aria-pressed', 'false'));
		clearErrors(form);
		setBusy(form, false);
		show(root, 'form');
		form.querySelector<HTMLElement>('[data-field="parentName"]')?.focus();
	});

	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		if (preview) return;
		const input = payloadFrom(form);
		const validation = validateTourRequest(input);
		if (!validation.value) {
			applyErrors(form, validation.errors);
			return;
		}
		clearErrors(form);
		setBusy(form, true);
		try {
			const response = await fetch('/api/tour-requests', {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'application/json' },
				body: JSON.stringify(input),
			});
			const body = (await response.json().catch(() => ({}))) as {
				ok?: boolean;
				fields?: Record<string, string>;
				code?: string;
				error?: string;
				givenName?: string;
				email?: string;
				dateLabel?: string;
				timeLabel?: string;
				honeypot?: boolean;
			};
			if (response.status === 400 && body.fields) {
				applyErrors(form, body.fields);
				return;
			}
			if (response.status === 409 || body.code === 'date_full') {
				const schedule = await loadSchedule().catch(() => null);
				if (schedule) {
					if (schedule.dates.length === 0) applySchedule(schedule, 'empty');
					else if ((schedule.bookable ?? 0) === 0) applySchedule(schedule, 'full');
					else renderDates(form, schedule.dates);
				}
				applyErrors(form, body.fields ?? { tourDateId: 'That tour is full. Please choose another date.' });
				return;
			}
			if (!response.ok || !body.ok) {
				showServerError(
					form,
					body.error ||
						`We couldn't send that just now. Please try again, or email ${TOUR_DEFAULTS.schoolEmail}.`,
				);
				return;
			}
			if (!body.honeypot) {
				capture('tour_requested', {
					tour_date: validation.value.tourDateId,
					grade_count: validation.value.grades.length,
					children_count: validation.value.children,
				});
			}
			showSuccess(root, {
				givenName: body.givenName || givenName(validation.value.parentName),
				email: body.email || validation.value.email,
				dateLabel: body.dateLabel || validation.value.tourDateId,
				timeLabel: body.timeLabel || '',
			});
		} catch {
			showServerError(
				form,
				`We couldn't send that just now. Please try again, or email ${TOUR_DEFAULTS.schoolEmail}.`,
			);
		} finally {
			setBusy(form, false);
		}
	});

	void boot();
}
