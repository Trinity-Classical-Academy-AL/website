/**
 * Required answers on a form a family fills in: fields marked `data-required`.
 * Submitting (the button with value "yes") with any left empty stops, marks
 * each one (.field-bad and its message) and moves to the first. A field clears
 * as soon as it's answered. `[data-required-left]` counts what's left.
 * Save draft never checks. The server checks again on submit.
 */
export {};
const FIELD = '[data-required]';

function answered(field: Element): boolean {
	const inputs = [...field.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([type="hidden"]), textarea, select')];
	if (inputs.some((input) => input instanceof HTMLInputElement && (input.type === 'radio' || input.type === 'checkbox'))) {
		return inputs.some((input) => input instanceof HTMLInputElement && input.checked);
	}
	if (inputs.some((input) => input instanceof HTMLInputElement && input.type === 'file')) {
		return field.querySelector('.has-current, .has-file') !== null || inputs.some((input) => input instanceof HTMLInputElement && !!input.files?.length);
	}
	return inputs.some((input) => input.value.trim() !== '');
}

function mark(field: Element, bad: boolean) {
	field.classList.toggle('field-bad', bad);
	const message = field.querySelector<HTMLElement>('[data-required-msg]');
	if (message) message.hidden = !bad;
	for (const input of field.querySelectorAll('input:not([type="hidden"]), textarea')) {
		if (bad) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
	}
}

function count(form: HTMLFormElement) {
	const left = [...form.querySelectorAll(FIELD)].filter((field) => !answered(field)).length;
	const label = form.querySelector<HTMLElement>('[data-required-left]');
	if (!label) return;
	label.innerHTML = left ? `<span class="req" aria-hidden="true">*</span> ${left} required ${left === 1 ? 'answer' : 'answers'} left` : 'All required answers done';
	label.dataset.done = left ? '' : 'yes';
}

function onEdit(event: Event) {
	const target = event.target as Element | null;
	const field = target?.closest?.(FIELD);
	const form = target?.closest?.('form');
	if (field && field.classList.contains('field-bad') && answered(field)) mark(field, false);
	if (form?.querySelector(FIELD)) count(form);
}
document.addEventListener('input', onEdit);
document.addEventListener('change', onEdit);

window.addEventListener('submit', (event) => {
	const form = event.target;
	if (!(form instanceof HTMLFormElement) || !form.querySelector(FIELD)) return;
	const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
	if (submitter?.value !== 'yes') return;
	const missing = [...form.querySelectorAll(FIELD)].filter((field) => !answered(field));
	for (const field of form.querySelectorAll(FIELD)) mark(field, missing.includes(field));
	count(form);
	if (!missing.length) return;
	event.preventDefault();
	event.stopImmediatePropagation();
	missing[0].scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
	missing[0].querySelector<HTMLElement>('input:not([type="hidden"]), textarea')?.focus({ preventScroll: true });
}, true);

// Count on load and after client-side navigation.
const init = () => document.querySelectorAll<HTMLFormElement>('form').forEach((form) => { if (form.querySelector(FIELD)) count(form); });
document.addEventListener('astro:page-load', init);
if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
