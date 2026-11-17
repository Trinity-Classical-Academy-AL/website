import { busy, toast } from './interactions';

const prepared = new WeakSet<HTMLElement>();
function prepareRsvp() {
	const root = document.querySelector<HTMLElement>('[data-rsvp-response]');
	if (!root || prepared.has(root)) return;
	prepared.add(root);
	const form = root.querySelector<HTMLFormElement>('[data-optimistic="rsvp"]')!;
	const region = root.querySelector<HTMLElement>('#rsvp-form-region')!;
	const edit = root.querySelector<HTMLButtonElement>('[data-rsvp-edit]')!;
	const confirmation = root.querySelector<HTMLElement>('[data-rsvp-confirmation]')!;
	const count = root.querySelector<HTMLElement>('[data-rsvp-count]')!;
	const note = root.querySelector<HTMLElement>('[data-rsvp-note]')!;
	const headInput = form.querySelector<HTMLInputElement>('[name="headCount"]')!;
	const noteInput = form.querySelector<HTMLTextAreaElement>('[name="note"]')!;
	const submit = form.querySelector<HTMLButtonElement>('[data-rsvp-submit]')!;
	const error = form.querySelector<HTMLElement>('[data-rsvp-error]')!;
	let confirmed = root.dataset.confirmed === 'true';
	let saved = { headCount: headInput.value, note: noteInput.value };
	let transition: ReturnType<typeof setTimeout> | undefined;
	const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

	function expand(open: boolean, animate = true) {
		clearTimeout(transition);
		const height = region.hidden ? 0 : region.getBoundingClientRect().height;
		region.hidden = false;
		region.inert = !open;
		region.style.overflow = 'hidden';
		region.style.height = `${height}px`;
		region.style.opacity = open ? '0' : '1';
		// Commit the start height before transitioning to the measured content height.
		void region.offsetHeight;
		region.style.height = open ? `${region.scrollHeight}px` : '0px';
		region.style.opacity = open ? '1' : '0';
		edit.setAttribute('aria-expanded', String(open));
		const finish = () => {
			region.hidden = !open;
			region.style.removeProperty('height');
			region.style.removeProperty('opacity');
			region.style.removeProperty('overflow');
		};
		if (!animate || reducedMotion.matches) finish();
		else transition = setTimeout(finish, 200);
		if (open) headInput.focus({ preventScroll: true });
	}
	function summarize(value: typeof saved, show: boolean) {
		confirmation.hidden = !show;
		count.textContent = `${value.headCount} attending`;
		note.textContent = value.note;
		note.hidden = !value.note;
		edit.hidden = !show;
		submit.textContent = show ? 'Update RSVP' : 'RSVP';
	}
	if (confirmed) { edit.hidden = false; if (error.hidden) expand(false, false); }
	edit.addEventListener('click', () => expand(edit.getAttribute('aria-expanded') !== 'true'));
	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		if (form.getAttribute('aria-busy') === 'true') return;
		const data = new FormData(form);
		const proposed = { headCount: headInput.value, note: noteInput.value.trim() };
		const wasConfirmed = confirmed;
		error.hidden = true;
		summarize(proposed, true);
		expand(false);
		edit.focus({ preventScroll: true });
		const finish = busy(form, submit);
		toast(wasConfirmed ? 'RSVP updated' : "You're on the list.");
		try {
			const response = await fetch(form.action, { method: 'POST', body: data, headers: { accept: 'application/json' }, credentials: 'same-origin' });
			if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Could not save. Please reload and sign in before trying again.');
			const result = await response.json();
			if (!response.ok || !result.ok) throw new Error(result.error || 'Could not save. Try again.');
			saved = { headCount: String(result.headCount), note: String(result.note) };
			confirmed = true;
			finish();
			summarize(saved, true);
		} catch (reason) {
			finish();
			summarize(saved, wasConfirmed);
			headInput.value = saved.headCount;
			noteInput.value = saved.note;
			const message = reason instanceof Error ? reason.message : 'Could not save. Check your connection before trying again.';
			error.textContent = message;
			error.hidden = false;
			expand(true);
			toast(message, true);
		}
	});
}

document.addEventListener('astro:page-load', prepareRsvp);
prepareRsvp();
