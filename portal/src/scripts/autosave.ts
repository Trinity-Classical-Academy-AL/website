/**
 * Autosave: a form marked `data-autosave` saves itself as a draft a moment
 * after the person stops typing (and when they leave a field or the page). The
 * form's `[data-autosave-status]` shows Saving… / Saved 2:41 PM / Couldn't save.
 * The page answers a request with `x-autosave: 1` with JSON instead of a page.
 * A chosen file uploads once; later saves leave it out until it changes.
 * Delegated, so pages swapped in by the client router need no setup.
 */
const FORM = 'form[data-autosave]';
const WAIT = 1200;
const timers = new WeakMap<HTMLFormElement, number>();
const busy = new WeakSet<HTMLFormElement>();
const again = new WeakSet<HTMLFormElement>();
const dirty = new WeakSet<HTMLFormElement>();

function showStatus(form: HTMLFormElement, text: string, state: 'saving' | 'saved' | 'error') {
	const el = form.querySelector<HTMLElement>('[data-autosave-status]');
	if (!el) return;
	el.textContent = text;
	el.dataset.state = state;
}

const fileId = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

async function save(form: HTMLFormElement) {
	if (!dirty.has(form) || form.getAttribute('aria-busy') === 'true') return;
	if (busy.has(form)) { again.add(form); return; }
	busy.add(form);
	dirty.delete(form);
	showStatus(form, 'Saving…', 'saving');
	const data = new FormData(form);
	data.set('publish', 'no');
	const sentFiles: HTMLInputElement[] = [];
	for (const input of form.querySelectorAll<HTMLInputElement>('input[type="file"][name]')) {
		const file = input.files?.[0];
		if (!file) { data.delete(input.name); continue; }
		if (input.dataset.savedFile === fileId(file)) data.delete(input.name);
		else sentFiles.push(input);
	}
	try {
		const response = await fetch(form.action || location.href, { method: 'POST', body: data, headers: { 'x-autosave': '1', accept: 'application/json' }, credentials: 'same-origin' });
		const body = await response.json().catch(() => ({ ok: false }));
		if (!response.ok || !body.ok) throw new Error(body.error || 'save failed');
		for (const input of sentFiles) { const file = input.files?.[0]; if (file) input.dataset.savedFile = fileId(file); }
		const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
		showStatus(form, `Saved ${time}`, 'saved');
	} catch {
		dirty.add(form);
		showStatus(form, 'Couldn’t save. We’ll keep trying.', 'error');
		window.setTimeout(() => save(form), 5000);
	} finally {
		busy.delete(form);
		if (again.has(form)) { again.delete(form); queue(form, 0); }
	}
}

function queue(form: HTMLFormElement, wait = WAIT) {
	dirty.add(form);
	window.clearTimeout(timers.get(form));
	timers.set(form, window.setTimeout(() => save(form), wait));
}

function onEdit(event: Event) {
	const target = event.target;
	if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
	const form = target.closest<HTMLFormElement>(FORM);
	if (!form || target.disabled) return;
	queue(form, event.type === 'change' ? 300 : WAIT);
}

document.addEventListener('input', onEdit);
document.addEventListener('change', onEdit);
// Leaving a field saves right away; so does leaving the page (best effort).
document.addEventListener('focusout', (event) => {
	const form = (event.target as Element | null)?.closest?.<HTMLFormElement>(FORM);
	if (form && dirty.has(form)) queue(form, 0);
});
document.addEventListener('visibilitychange', () => {
	if (document.visibilityState !== 'hidden') return;
	for (const form of document.querySelectorAll<HTMLFormElement>(FORM)) if (dirty.has(form)) save(form);
});
// Submitting (Save draft or Submit) supersedes a pending autosave.
document.addEventListener('submit', (event) => {
	const form = event.target;
	if (form instanceof HTMLFormElement && form.matches(FORM)) { window.clearTimeout(timers.get(form)); dirty.delete(form); }
}, true);
