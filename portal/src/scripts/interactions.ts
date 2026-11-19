import { navigate } from 'astro:transitions/client';
// @ts-expect-error Astro provides the same adapter virtual module to ClientRouter.
import { internalFetchHeaders } from 'virtual:astro:adapter-config/client';
import type { TransitionBeforePreparationEvent, TransitionBeforeSwapEvent } from 'astro:transitions/client';
import { optimisticUpdate, searchURL, navigationScrollMode, submitAndRevalidate } from './interactions-core';

type Mutation = {
	form: HTMLFormElement; restore: () => void; finish: () => void;
	path: string; url: string; failed: boolean; focus: ReturnType<typeof captureFocus>; scroll: ReturnType<typeof captureScroll>;
};
let pending: Mutation | undefined;
let nativeFinish: (() => void) | undefined;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let searchInput: HTMLInputElement | undefined;
let returnFocus: HTMLElement | undefined;

function visible(node: HTMLElement) { return node.getClientRects().length > 0 && !node.closest('[hidden]'); }
export function toast(message: string, error = false) {
	let region = document.querySelector<HTMLElement>('[data-interaction-toasts]');
	if (!region) {
		region = document.createElement('div');
		region.dataset.interactionToasts = '';
		region.className = 'interaction-toasts';
		region.setAttribute('aria-live', 'polite');
		region.setAttribute('aria-atomic', 'true');
		document.body.append(region);
	}
	region.replaceChildren();
	const item = document.createElement('div');
	item.className = `toast ${error ? 't-err' : 't-ok'}`;
	const text = document.createElement('span');
	text.textContent = message;
	const close = document.createElement('button');
	close.type = 'button';
	close.className = 'btn btn-g btn-sm';
	close.setAttribute('aria-label', 'Dismiss notification');
	close.textContent = '×';
	close.addEventListener('click', () => item.remove());
	item.append(text, close);
	region.append(item);
	if (!error) setTimeout(() => item.remove(), 6000);
}
function captureScroll() {
	return { window: [scrollX, scrollY] as [number, number], containers: ['.portal-main', '.mwrap', '.sh-b'].flatMap(selector =>
		Array.from(document.querySelectorAll<HTMLElement>(selector)).map((node, index) => ({ selector, index, x: node.scrollLeft, y: node.scrollTop }))) };
}
function restoreScroll(saved: ReturnType<typeof captureScroll>) {
	scrollTo(...saved.window);
	for (const { selector, index, x, y } of saved.containers) {
		const node = document.querySelectorAll<HTMLElement>(selector)[index];
		if (node) { node.scrollLeft = x; node.scrollTop = y; }
	}
}
// One owner for both responsive scroll surfaces. Snapshot before optimistic DOM
// changes; use the final URL at swap time because POSTs can redirect elsewhere.
const scrollEntries = new Map<number, ReturnType<typeof captureScroll>>();
let scrollEntry = history.state?.index ?? 0;
let scrollNavigation: { from: URL; saved: ReturnType<typeof captureScroll>; type: string } | undefined;
let swapScroll: ReturnType<typeof captureScroll> | undefined;
document.addEventListener('astro:before-preparation', (raw) => {
	const event = raw as TransitionBeforePreparationEvent;
	const saved = (event.info?.portalMutation as Mutation | undefined)?.scroll || captureScroll();
	scrollEntries.set(scrollEntry, saved);
	const navigation = { from: event.from, saved, type: event.navigationType };
	scrollNavigation = navigation;
	swapScroll = undefined;
	event.signal.addEventListener('abort', () => {
		if (scrollNavigation === navigation) { scrollNavigation = undefined; swapScroll = undefined; }
	}, { once: true });
});
document.addEventListener('scroll', (event) => {
	if (!scrollNavigation && (event.target === document || event.target instanceof HTMLElement && event.target.isConnected && event.target.matches('.portal-main, .mwrap, .sh-b'))) {
		scrollEntries.set(scrollEntry, captureScroll());
	}
}, { capture: true, passive: true });
document.addEventListener('astro:before-swap', (raw) => {
	if (!scrollNavigation) return;
	const event = raw as TransitionBeforeSwapEvent;
	const mode = navigationScrollMode(scrollNavigation.from, event.to, scrollNavigation.type);
	swapScroll = mode === 'preserve' ? scrollNavigation.saved : mode === 'history' ? scrollEntries.get(history.state?.index ?? 0) : undefined;
});
document.addEventListener('astro:after-swap', () => {
	if (swapScroll) restoreScroll(swapScroll);
	else if (scrollNavigation?.type !== 'traverse') {
		// ClientRouter owns window/hash navigation to a different pathname.
		document.querySelectorAll<HTMLElement>('.portal-main, .mwrap').forEach(node => { node.scrollTop = 0; node.scrollLeft = 0; });
	}
});
document.addEventListener('astro:page-load', () => {
	if (swapScroll) restoreScroll(swapScroll);
	scrollEntry = history.state?.index ?? 0;
	scrollNavigation = undefined;
	swapScroll = undefined;
});

function captureFocus() {
	const node = document.activeElement as HTMLInputElement | null;
	const shell = node?.closest('.shell-m') ? '.shell-m' : node?.closest('.shell-d') ? '.shell-d' : 'body';
	return { node, shell, name: node?.getAttribute('name'), id: node?.id,
		start: node?.selectionStart, end: node?.selectionEnd };
}
function restoreFocus(saved: ReturnType<typeof captureFocus>) {
	const scope = document.querySelector(saved.shell);
	const node = saved.node?.isConnected ? saved.node : Array.from(scope?.querySelectorAll<HTMLElement>('input,textarea,select,button,a') || [])
		.find(el => saved.id ? el.id === saved.id : saved.name && el.getAttribute('name') === saved.name);
	if (node && visible(node)) {
		node.focus({ preventScroll: true });
		if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
			if (saved.start != null) try { node.setSelectionRange(saved.start, saved.end ?? saved.start); } catch { /* non-text input */ }
		}
	} else {
		const heading = Array.from(document.querySelectorAll<HTMLElement>('h1')).find(visible);
		heading?.setAttribute('tabindex', '-1');
		heading?.focus({ preventScroll: true });
	}
}
export function busy(form: HTMLFormElement, submitter: HTMLElement | null, deferDisable = false) {
	form.setAttribute('aria-busy', 'true');
	const button = submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement ? submitter : null;
	const html = button?.innerHTML;
	const disabled = button?.disabled;
	// FormData is already captured: disabling the submitter cannot drop publish/action.
	if (button && !deferDisable) button.disabled = true;
	const timer = setTimeout(() => {
		if (!button) return;
		button.disabled = true;
		button.classList.add('busy');
		if (button instanceof HTMLButtonElement) {
			const spinner = document.createElement('span');
			spinner.className = 'spin'; spinner.setAttribute('aria-hidden', 'true');
			button.replaceChildren(spinner, document.createTextNode(button.dataset.busy || button.textContent || 'Saving…'));
		}
	}, 150);
	return () => {
		clearTimeout(timer);
		form.removeAttribute('aria-busy');
		if (button) { button.disabled = disabled || false; button.classList.remove('busy'); if (html !== undefined) button.innerHTML = html; }
	};
}
function rollback(state: Mutation, message: string) {
	state.failed = true;
	state.restore(); state.finish();
	state.form.dispatchEvent(new CustomEvent('portal:rollback'));
	restoreFocus(state.focus);
	toast(message, true);
}

document.addEventListener('submit', (event) => {
	const form = event.target;
	if (!(form instanceof HTMLFormElement) || event.defaultPrevented || (form.getAttribute('method') || 'get').toLowerCase() !== 'post') return;
	// The RSVP page owns its scoped confirmation, rollback, and JSON response.
	if (form.dataset.optimistic === 'rsvp') return;
	const submitter = (event as SubmitEvent).submitter;
	if (pending || form.getAttribute('aria-busy') === 'true') { event.preventDefault(); return; }
	if (!form.hasAttribute('data-enhance') || form.hasAttribute('data-astro-reload')) {
		// Native Astro/auth forms still own their navigation and cookie handling.
		// Defer disabling until their submitter has been serialized by ClientRouter.
		nativeFinish = busy(form, submitter, true);
		return;
	}
	const action = new URL(submitter?.getAttribute('formaction') || form.getAttribute('action') || location.href, location.href);
	if (action.origin !== location.origin || form.target && form.target !== '_self') return;
	const data = new FormData(form, submitter as HTMLButtonElement | null);
	event.preventDefault();
	clearTimeout(searchTimer);
	const focus = captureFocus();
	const state: Mutation = { form, focus, path: location.pathname, url: location.href, scroll: captureScroll(), failed: false,
		restore: optimisticUpdate(form, data), finish: busy(form, submitter) };
	pending = state;
	void navigate(action.href, { formData: data, sourceElement: form, info: { portalMutation: state } }).catch(() => {
		rollback(state, 'Could not save. Check your connection before trying again.');
	}).finally(() => { state.finish(); if (pending === state) pending = undefined; });
}, true);

document.addEventListener('astro:before-preparation', (raw) => {
	const event = raw as TransitionBeforePreparationEvent;
	const state = event.info?.portalMutation as Mutation | undefined;
	// A navigation may supersede a POST. Never replay an uncertain mutation.
	if (pending && state !== pending) { pending.restore(); pending.finish(); pending = undefined; }
	if (!state) return;
	event.loader = async () => {
		await submitAndRevalidate(event, state, { headers: internalFetchHeaders, document, rollback: message => rollback(state, message) });
	};
});
document.addEventListener('astro:before-swap', (raw) => {
	const event = raw as TransitionBeforeSwapEvent;
	if (event.info?.portalMutation?.failed) event.swap = () => {};
	else {
		if (!(event.sourceElement instanceof HTMLInputElement && event.sourceElement.closest('form.tools'))) {
			document.querySelectorAll('form.tools input[name="q"]').forEach(input => input.removeAttribute('data-astro-transition-persist'));
		}
		prepareSearch(event.newDocument, event.to.pathname);
	}
});
document.addEventListener('astro:after-swap', () => {
	if (pending && location.pathname === pending.path) {
		restoreFocus(pending.focus);
		if (!pending.failed && pending.form.dataset.success) toast(pending.form.dataset.success);
	}
	if (searchInput?.isConnected) searchInput.focus({ preventScroll: true });
});

function prepareSearch(doc: Document, path: string) {
	// Persist each responsive search copy separately, without depending on suffixed IDs.
	doc.querySelectorAll<HTMLFormElement>('form.tools').forEach((form, index) => {
		const input = form.querySelector<HTMLInputElement>('input[name="q"]');
		if (input) input.setAttribute('data-astro-transition-persist', `search:${path}:${index}`);
	});
}
function prepare() {
	prepareSearch(document, location.pathname);
	for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
		const url = new URL(anchor.href, location.href);
		const instant = Array.from(document.querySelectorAll<HTMLElement>('[data-instant-dialog-url]')).some(node => new URL(node.dataset.instantDialogUrl!, location.href).href === url.href);
		if (instant) { anchor.dataset.astroPrefetch = 'false'; continue; }
		if (url.origin === location.origin && /(?:sheet|event|slot|reply|doc|student|dialog|confirm|enroll|cancel|remind|submission|edit)=/.test(url.search)) anchor.dataset.astroPrefetch = 'tap';
	}
	const dialog = activeDialog();
	if (dialog && !dialog.contains(document.activeElement)) {
		dialog.setAttribute('tabindex', '-1');
		dialog.focus({ preventScroll: true });
	}
}
document.addEventListener('astro:page-load', () => {
	nativeFinish?.();
	nativeFinish = undefined;
	prepare();
});
prepare();

document.addEventListener('input', (event) => {
	const input = event.target;
	if (!(input instanceof HTMLInputElement) || input.name !== 'q' || !input.closest('form.tools') || (event as InputEvent).isComposing) return;
	clearTimeout(searchTimer);
	if (input.form?.hasAttribute('data-local-search')) {
		const query = input.value.trim().toLowerCase();
		document.querySelectorAll<HTMLInputElement>('form[data-local-search] input[name="q"]').forEach(copy => { if (copy !== input) copy.value = input.value; });
		for (const row of document.querySelectorAll<HTMLElement>('[data-search-row]')) row.hidden = !(row.dataset.searchRow || '').toLowerCase().includes(query);
		for (const group of document.querySelectorAll<HTMLElement>('[data-search-group]')) group.hidden = !group.querySelector('[data-search-row]:not([hidden])');
		const matches = document.querySelector('[data-search-row]:not([hidden])');
		document.querySelectorAll<HTMLElement>('[data-search-empty]').forEach(node => { node.hidden = !!matches || !query; });
		history.replaceState(history.state, '', searchURL(input.form, location.href));
		return;
	}
	searchInput = input;
	searchTimer = setTimeout(() => {
		if (!input.isConnected || pending) return;
		const form = input.form!;
		void navigate(searchURL(form, location.href).href, { history: 'replace', sourceElement: input });
	}, 200);
});
document.addEventListener('submit', (event) => {
	if ((event.target as Element)?.matches('form.tools')) clearTimeout(searchTimer);
});

// Existing Ark dialogs own their focus handling. Apply equivalent behavior to plain SSR overlays.
function activeDialog() {
	return Array.from(document.querySelectorAll<HTMLElement>('.ov .dlg, .ov .ssheet')).filter(node => !node.hasAttribute('data-scope') && visible(node)).at(-1);
}
document.addEventListener('keydown', (event) => {
	const dialog = activeDialog();
	if (!dialog) return;
	if (event.key === 'Escape') {
		const close = dialog.querySelector<HTMLAnchorElement>('a.sh-ic, a.btn-s');
		if (close) { event.preventDefault(); close.click(); }
	}
	if (event.key === 'Tab') {
		const controls = Array.from(dialog.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),textarea,select,[tabindex="0"]')).filter(visible);
		const first = controls[0], last = controls.at(-1);
		if (!first) { event.preventDefault(); return; }
		if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
		else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus(); }
	}
});

// Capture before ClientRouter so an already rendered confirmation needs no request.
document.addEventListener('click', (event) => {
	const target = event.target as Element;
	const passwordToggle = target.closest<HTMLButtonElement>('.pw-t:not([data-scope])');
	if (passwordToggle) {
		const input = passwordToggle.parentElement?.querySelector('input');
		if (input) { const show = input.type === 'password'; input.type = show ? 'text' : 'password'; passwordToggle.textContent = show ? 'Hide' : 'Show'; }
		return;
	}
	const external = target.closest<HTMLButtonElement>('button[data-submit-action]');
	if (external) {
		const scope = external.closest('.shell-d, .shell-m') || document;
		const form = Array.from(scope.querySelectorAll<HTMLFormElement>('form[data-action-form]')).find(form => form.dataset.actionForm === external.dataset.submitAction);
		if (form) { event.preventDefault(); form.requestSubmit(); }
		return;
	}
	const anchor = target.closest<HTMLAnchorElement>('a[href]');
	if (!anchor || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || anchor.target && anchor.target !== '_self') return;
	const url = new URL(anchor.href);
	const local = Array.from(document.querySelectorAll<HTMLElement>('[data-instant-dialog-url]')).filter(node => new URL(node.dataset.instantDialogUrl!, location.href).href === url.href);
	if (local.length) {
		event.preventDefault(); returnFocus = anchor;
		local.forEach(node => { node.hidden = false; });
		history.replaceState(history.state, '', url);
		prepare();
		return;
	}
	const overlay = anchor.closest<HTMLElement>('[data-instant-dialog-close]');
	if (overlay && new URL(overlay.dataset.instantDialogClose!, location.href).href === url.href) {
		event.preventDefault();
		const openURL = overlay.dataset.instantDialogUrl;
		document.querySelectorAll<HTMLElement>('[data-instant-dialog-url]').forEach(node => { if (node.dataset.instantDialogUrl === openURL) node.hidden = true; });
		history.replaceState(history.state, '', url);
		if (returnFocus?.isConnected && visible(returnFocus)) returnFocus.focus({ preventScroll: true });
		else prepare();
	}
}, true);
