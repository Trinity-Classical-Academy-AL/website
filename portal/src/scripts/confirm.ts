/**
 * Confirm before a form does something big: `<form data-confirm="Release these
 * report cards?">`, or on one button with `data-confirm` (the button's own message
 * wins). Optional `data-confirm-yes` names the confirming button ("Release") and
 * `data-confirm-danger` makes it red.
 *
 * When only some values send an email (an application stage, say), the form gives
 * `data-confirm-field="status"` and `data-confirm-map` (JSON: value → question);
 * values not in the map go through without asking. A form with
 * `data-confirm-revert` is re-rendered on Cancel, so a dropdown or a dragged card
 * goes back to where it was.
 *
 * The question comes first and the form is only submitted after a Yes: the click
 * (or Enter) is stopped before any submit event exists, so no other handler,
 * enhanced or native, can send it early. Cancel, Escape or a backdrop click send
 * nothing.
 */
import { navigate } from 'astro:transitions/client';

const confirmed = new WeakSet<HTMLFormElement>();

type Ask = { message: string; yes: string; danger: boolean };
function askFor(form: HTMLFormElement, submitter: HTMLElement | null): Ask | null {
	// The map can sit on the form, or on one button (only Publish asks, not Save draft).
	const mapped = submitter?.dataset.confirmMap ? submitter : form.dataset.confirmMap ? form : null;
	if (mapped?.dataset.confirmField && mapped.dataset.confirmMap) {
		const value = new FormData(form, submitter as HTMLButtonElement | null).get(mapped.dataset.confirmField);
		let map: Record<string, string | { q: string; yes?: string; danger?: boolean }> = {};
		try { map = JSON.parse(mapped.dataset.confirmMap); } catch {}
		const entry = typeof value === 'string' ? map[value] : undefined;
		if (!entry) return null;
		return typeof entry === 'string' ? { message: entry, yes: form.dataset.confirmYes || 'Continue', danger: false } : { message: entry.q, yes: entry.yes || 'Continue', danger: !!entry.danger };
	}
	const source = submitter?.hasAttribute('data-confirm') ? submitter : form.hasAttribute('data-confirm') ? form : null;
	if (!source) return null;
	return {
		message: source.dataset.confirm || 'Are you sure?',
		yes: source.dataset.confirmYes || form.dataset.confirmYes || 'Continue',
		danger: source.hasAttribute('data-confirm-danger') || form.hasAttribute('data-confirm-danger'),
	};
}

function ask({ message, yes, danger }: Ask, opener: HTMLElement | null): Promise<boolean> {
	return new Promise((resolve) => {
		const overlay = document.createElement('div');
		overlay.className = 'ov ov-top confirm-ov';
		overlay.innerHTML = `<div class="dlg" role="alertdialog" aria-modal="true" aria-labelledby="confirm-q"><p class="h3" id="confirm-q"></p><div class="acts"><button type="button" class="btn btn-s" data-no>Cancel</button><button type="button" class="btn ${danger ? 'btn-d' : 'btn-p'}" data-yes></button></div></div>`;
		overlay.querySelector('#confirm-q')!.textContent = message;
		overlay.querySelector('[data-yes]')!.textContent = yes;
		const done = (answer: boolean) => {
			document.removeEventListener('keydown', onKey, true);
			overlay.remove();
			opener?.focus({ preventScroll: true });
			resolve(answer);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); done(false); }
			if (event.key === 'Tab') {
				const buttons = Array.from(overlay.querySelectorAll<HTMLButtonElement>('button'));
				const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
				event.preventDefault();
				buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
			}
		};
		overlay.addEventListener('click', (event) => {
			const target = event.target as Element;
			if (target === overlay || target.closest('[data-no]')) done(false);
			else if (target.closest('[data-yes]')) done(true);
		});
		document.addEventListener('keydown', onKey, true);
		// Inside the portal root, where buttons and dialogs get their styles: the one on
		// screen. Phones show a second copy of the page; the desktop one is hidden there.
		const roots = Array.from(document.querySelectorAll<HTMLElement>('.root'));
		const root = [opener?.closest<HTMLElement>('.root'), ...roots].find((node) => node && node.getClientRects().length);
		(root ?? roots[0] ?? document.body).append(overlay);
		overlay.querySelector<HTMLButtonElement>('[data-yes]')!.focus();
	});
}

async function confirmThenSubmit(form: HTMLFormElement, submitter: HTMLElement | null, question: Ask) {
	if (!(await ask(question, submitter))) {
		// Put back a dropdown or a dragged card that already shows the unsaved choice.
		if (form.hasAttribute('data-confirm-revert')) void navigate(location.href, { history: 'replace' });
		return;
	}
	confirmed.add(form);
	try { form.requestSubmit(submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement ? submitter : undefined); }
	finally { confirmed.delete(form); }
}

// Clicking a submit button: stop it before the browser makes a submit event.
document.addEventListener('click', (event) => {
	const button = (event.target as Element).closest<HTMLButtonElement | HTMLInputElement>('button, input[type="submit"]');
	const form = button?.form;
	if (!button || !form || button.type !== 'submit' || confirmed.has(form)) return;
	const question = askFor(form, button);
	if (!question) return;
	event.preventDefault();
	event.stopImmediatePropagation();
	void confirmThenSubmit(form, button, question);
}, true);

// Anything else that submits (Enter in a field, requestSubmit from a script).
window.addEventListener('submit', (event) => {
	const form = event.target;
	if (!(form instanceof HTMLFormElement) || confirmed.has(form)) return;
	const submitter = (event as SubmitEvent).submitter;
	const question = askFor(form, submitter);
	if (!question) return;
	event.preventDefault();
	event.stopImmediatePropagation();
	void confirmThenSubmit(form, submitter, question);
}, true);
