import { INTEREST_FIELD_ORDER, TOUR_DEFAULTS } from '../lib/admissions/defaults.ts';
import { errorSummary, givenName, validateInterest } from '../lib/admissions/validation.ts';
import { capture } from './analytics.ts';

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
	form.querySelectorAll<HTMLElement>('[aria-invalid="true"]').forEach((node) => node.setAttribute('aria-invalid', 'false'));
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
		form.querySelector<HTMLElement>(`[data-field="${name}"]`)?.setAttribute('aria-invalid', 'true');
	}
	const first = INTEREST_FIELD_ORDER.find((name) => errors[name]);
	if (first) form.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
}

function show(card: HTMLElement, name: 'form' | 'success' | 'server') {
	card.querySelectorAll<HTMLElement>('[data-interest-view]').forEach((view) => {
		view.toggleAttribute('hidden', view.dataset.interestView !== name);
	});
}

export function initInterestForms() {
	const preview = document.documentElement.dataset.previewStates === 'true' ? new URLSearchParams(location.search).get('interest-state') : null;

	document.querySelectorAll<HTMLElement>('[data-interest]').forEach((card) => {
		const form = card.querySelector<HTMLFormElement>('form');
		if (!form || form.dataset.bound === 'true') return;
		form.dataset.bound = 'true';

		if (preview === 'error') {
			applyErrors(form, { name: 'Enter your name', email: 'Enter a valid email address like name@example.com' });
		}
		if (preview === 'submitting') {
			const button = form.querySelector<HTMLButtonElement>('[data-submit]');
			if (button) {
				button.disabled = true;
				button.textContent = 'Sending…';
			}
			form.setAttribute('aria-busy', 'true');
		}
		if (preview === 'success') {
			const name = card.querySelector<HTMLElement>('[data-success-name]');
			if (name) name.textContent = 'Jordan';
			show(card, 'success');
		}
		if (preview === 'server') {
			const server = form.querySelector<HTMLElement>('[data-server-error]');
			if (server) {
				server.hidden = false;
				server.textContent = `We couldn't send that. Please try again, or email ${TOUR_DEFAULTS.schoolEmail}.`;
			}
		}

		form.addEventListener('submit', async (event) => {
			event.preventDefault();
			if (preview) return;
			const data = new FormData(form);
			const input = {
				name: String(data.get('name') ?? ''),
				email: String(data.get('email') ?? ''),
				phone: String(data.get('phone') ?? ''),
				message: String(data.get('message') ?? ''),
				pagePath: card.dataset.pagePath || location.pathname,
				company: String(data.get('company') ?? ''),
			};
			const validation = validateInterest(input);
			if (!validation.value) {
				applyErrors(form, validation.errors);
				return;
			}
			clearErrors(form);
			const button = form.querySelector<HTMLButtonElement>('[data-submit]');
			const label = button?.textContent ?? 'Send';
			if (button) {
				button.disabled = true;
				button.textContent = 'Sending…';
			}
			form.setAttribute('aria-busy', 'true');
			try {
				const response = await fetch('/api/interest', {
					method: 'POST',
					headers: { 'content-type': 'application/json', accept: 'application/json' },
					body: JSON.stringify(input),
				});
				const body = (await response.json().catch(() => ({}))) as {
					ok?: boolean;
					fields?: Record<string, string>;
					givenName?: string;
					honeypot?: boolean;
					error?: string;
				};
				if (response.status === 400 && body.fields) {
					applyErrors(form, body.fields);
					return;
				}
				if (!response.ok || !body.ok) {
					const server = form.querySelector<HTMLElement>('[data-server-error]');
					if (server) {
						server.hidden = false;
						server.textContent = body.error || `We couldn't send that. Please try again, or email ${TOUR_DEFAULTS.schoolEmail}.`;
						server.focus();
					}
					return;
				}
				if (!body.honeypot) capture('interest_submitted');
				const successName = card.querySelector<HTMLElement>('[data-success-name]');
				if (successName) successName.textContent = body.givenName || givenName(validation.value.name);
				show(card, 'success');
				card.querySelector<HTMLElement>('[data-success-heading]')?.focus();
			} catch {
				const server = form.querySelector<HTMLElement>('[data-server-error]');
				if (server) {
					server.hidden = false;
					server.textContent = `We couldn't send that. Please try again, or email ${TOUR_DEFAULTS.schoolEmail}.`;
					server.focus();
				}
			} finally {
				if (button) {
					button.disabled = false;
					button.textContent = label;
				}
				form.setAttribute('aria-busy', 'false');
			}
		});
	});
}
