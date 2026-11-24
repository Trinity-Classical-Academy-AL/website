import { navigate } from 'astro:transitions/client';
import { withClientState } from './url-state';
import './confirm';
import { delayedSkeleton, showPageSkeleton, showSheetSkeleton } from './skeletons';
import { syncDialogs } from '../lib/dialogs';
// @ts-expect-error Astro provides the same adapter virtual module to ClientRouter.
import { internalFetchHeaders } from 'virtual:astro:adapter-config/client';
import type { TransitionBeforePreparationEvent, TransitionBeforeSwapEvent } from 'astro:transitions/client';
import { optimisticUpdate, searchURL, navigationScrollMode, submitAndRevalidate } from './interactions-core';
import './prefetch';

type Mutation = {
	form: HTMLFormElement; restore: () => void; finish: () => void;
	path: string; url: string; failed: boolean; focus: ReturnType<typeof captureFocus>; scroll: ReturnType<typeof captureScroll>;
};
let pending: Mutation | undefined;
let nativeFinish: (() => void) | undefined;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let searchInput: HTMLInputElement | undefined;
let returnFocus: HTMLElement | undefined;
let dialogNavigation: { url: URL } | undefined;

function visible(node: HTMLElement) { return node.getClientRects().length > 0 && !node.closest('[hidden]'); }
const TOAST_ICONS = {
	ok: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
	err: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" aria-hidden="true"><path d="M12 7v6M12 17h.01"/></svg>',
};
const CLOSE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

/** The one toast stack: fixed top right, newest at the top. */
function toastRegion() {
	let region = document.querySelector<HTMLElement>('[data-interaction-toasts]');
	if (!region) {
		region = document.createElement('div');
		region.dataset.interactionToasts = '';
		region.className = 'interaction-toasts';
		region.setAttribute('aria-live', 'polite');
		document.body.append(region);
	}
	return region;
}

/** Give a toast its icon and close button, put it in the stack, and time it out (errors stay). */
function present(item: HTMLElement, error: boolean) {
	if (!item.querySelector('.toast-ic')) {
		const icon = document.createElement('span'); icon.className = 'toast-ic'; icon.innerHTML = TOAST_ICONS[error ? 'err' : 'ok'];
		item.prepend(icon);
	}
	if (!item.querySelector('.toast-x')) {
		const close = document.createElement('button');
		close.type = 'button'; close.className = 'toast-x'; close.setAttribute('aria-label', 'Dismiss notification'); close.innerHTML = CLOSE_ICON;
		close.addEventListener('click', () => dismiss(item));
		item.append(close);
	}
	const region = toastRegion();
	// Same message twice (both responsive copies, or a repeat) shows once.
	for (const other of region.querySelectorAll<HTMLElement>('.toast')) if (other.textContent === item.textContent) other.remove();
	region.prepend(item);
	while (region.children.length > 3) region.lastElementChild!.remove();
	if (!error) setTimeout(() => dismiss(item), 5000);
}

function dismiss(item: HTMLElement) {
	if (!item.isConnected || item.classList.contains('leaving')) return;
	item.classList.add('leaving');
	item.addEventListener('animationend', () => item.remove(), { once: true });
	setTimeout(() => item.remove(), 400);
}

export function toast(message: string, error = false) {
	const item = document.createElement('div');
	item.className = `toast ${error ? 't-err' : 't-ok'}`;
	item.setAttribute('role', error ? 'alert' : 'status');
	const text = document.createElement('span');
	text.className = 'toast-msg';
	text.textContent = message;
	item.append(text);
	present(item, error);
}

/** Server-rendered <Toast>s join the stack; the copy in the hidden responsive layout is dropped. */
function adoptPageToasts() {
	const shown = new Set<string>();
	for (const item of document.querySelectorAll<HTMLElement>('[data-toast]')) {
		item.removeAttribute('data-toast');
		item.dataset.toastParams?.split(',').forEach((key) => shown.add(key));
		if (item.closest('.shell-d, .shell-m') && !item.getClientRects().length) { item.remove(); continue; }
		present(item, item.classList.contains('t-err'));
	}
	// A reload shouldn't repeat the toast: drop its trigger (?saved=1 …) from the address bar.
	const url = new URL(location.href);
	shown.forEach((key) => url.searchParams.delete(key));
	if (url.href !== location.href) history.replaceState(history.state, '', url);
}
document.addEventListener('astro:page-load', adoptPageToasts);
adoptPageToasts();
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
	syncDialogs(document, dialogNavigation?.url ?? new URL(location.href));
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
		// The header's close button first; a footer Cancel only when there is none.
		const close = dialog.querySelector<HTMLAnchorElement>('a.sh-ic[aria-label="Close"]') ?? dialog.querySelector<HTMLAnchorElement>('a.btn-s');
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
	if (target.matches('.ov[data-instant-dialog-close]')) {
		event.preventDefault();
		closeDialog(target as HTMLElement);
		return;
	}
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
		void navigateDialog(url, { sourceElement: anchor, info: { portalDialog: true } });
		return;
	}
	const overlay = anchor.closest<HTMLElement>('[data-instant-dialog-close]');
	if (overlay && new URL(overlay.dataset.instantDialogClose!, location.href).href === url.href) {
		event.preventDefault();
		closeDialog(overlay);
	}
}, true);

function closeDialog(overlay: HTMLElement) {
	const url = new URL(overlay.dataset.instantDialogClose!, location.href);
	// Dismiss validation fallbacks in both responsive copies too.
	document.querySelectorAll<HTMLElement>('[data-instant-dialog-url]').forEach(node => {
		if (node.dataset.instantDialogUrl === overlay.dataset.instantDialogUrl) delete node.dataset.dialogFallbackUrl;
	});
	syncDialogs(document, url);
	if (returnFocus?.isConnected && visible(returnFocus)) returnFocus.focus({ preventScroll: true });
	// Confirmation dismissal preserves its parent sheet's draft. Closing a sheet
	// revalidates the page too (for example /tour hides its booking form under Other time).
	const confirmation = overlay.querySelector(':scope > .dlg');
	void navigateDialog(url, { info: confirmation ? { portalDialog: true } : undefined }).then(() => {
		if (returnFocus?.isConnected && visible(returnFocus)) returnFocus.focus({ preventScroll: true });
	});
}

// When a rapid Escape supersedes an opening dialog, ClientRouter skips the running view
// transition and its own `finished.finally()` chain rejects with nobody listening. The skip is
// intended, so keep it out of the console as an unhandled error.
window.addEventListener('unhandledrejection', (event) => {
	const reason = event.reason;
	if (reason instanceof DOMException && reason.name === 'AbortError' && reason.message.startsWith('Transition was skipped')) event.preventDefault();
});

function navigateDialog(target: URL, options: Parameters<typeof navigate>[1]) {
	const url = withClientState(target);
	const state = { url };
	dialogNavigation = state;
	syncDialogs(document, url);
	// A rapid Escape may supersede opening before ClientRouter commits its URL.
	// Keep all copies at the latest requested state through both navigation lifecycles.
	return navigate(url.href, options).finally(() => {
		if (dialogNavigation === state) {
			dialogNavigation = undefined;
			syncDialogs(document, new URL(location.href));
		}
	});
}

// Use ClientRouter for its history index, lifecycle and scroll ownership, while
// keeping an already-rendered dialog (and typed draft) in place.
document.addEventListener('astro:before-preparation', (raw) => {
	const event = raw as TransitionBeforePreparationEvent;
	if (dialogNavigation && event.to.href !== dialogNavigation.url.href) dialogNavigation = undefined;
	if (event.info?.portalDialog) event.loader = async () => { event.newDocument = document; };
});
document.addEventListener('astro:before-swap', (raw) => {
	const event = raw as TransitionBeforeSwapEvent;
	if (event.info?.portalDialog) event.swap = () => {};
});
document.addEventListener('astro:after-swap', () => syncDialogs(document, dialogNavigation?.url ?? new URL(location.href)));
window.addEventListener('popstate', () => {
	dialogNavigation = undefined;
	syncDialogs(document, new URL(location.href));
});

// Loading belongs to GET navigation only; optimistic POSTs retain their feedback.
let finishSkeleton: (() => void) | undefined;
document.addEventListener('astro:before-preparation', (raw) => {
	finishSkeleton?.(); finishSkeleton = undefined;
	const event = raw as TransitionBeforePreparationEvent;
	if (event.formData || event.info?.portalDialog || event.to.href === event.from.href) return;
	const sheetKeys = ['sheet', 'event', 'slot', 'rule', 'reply', 'doc', 'student', 'submission', 'inquiry'];
	const sheet = event.to.pathname === event.from.pathname && sheetKeys.some(key => event.to.searchParams.has(key) && event.to.searchParams.get(key) !== event.from.searchParams.get(key));
	const finish = delayedSkeleton(() => sheet ? showSheetSkeleton(document) : showPageSkeleton(document));
	finishSkeleton = finish;
	event.signal.addEventListener('abort', finish, { once: true });
});
document.addEventListener('astro:before-swap', () => { finishSkeleton?.(); finishSkeleton = undefined; });

// Table rows with data-href open like a link: anywhere on the row, or Enter when focused.
// Clicks on the row's own controls (links, buttons, inputs) keep their behavior.
function openRow(row: HTMLElement, newTab: boolean) {
	const href = row.dataset.href;
	if (!href) return;
	// The router carries the list's search and page; a new tab needs them in the link.
	if (newTab) { window.open(withClientState(new URL(href, location.href)).href, '_blank', 'noopener'); return; }
	// A real anchor click goes through instant dialogs and the client router like any link.
	const anchor = document.createElement('a');
	anchor.href = href; anchor.hidden = true;
	document.body.append(anchor); anchor.click(); anchor.remove();
}
document.addEventListener('click', (event) => {
	const target = event.target as Element;
	const row = target.closest<HTMLElement>('tr[data-href]');
	if (!row || event.button || target.closest('a, button, input, select, textarea, label, [role="combobox"]')) return;
	if (getSelection()?.toString()) return; // let people select text in a row
	openRow(row, event.metaKey || event.ctrlKey);
});
document.addEventListener('keydown', (event) => {
	const row = event.target instanceof HTMLElement && event.target.matches('tr[data-href]') ? event.target : null;
	if (row && event.key === 'Enter') { event.preventDefault(); openRow(row, event.metaKey || event.ctrlKey); }
});
import './sort';
import './file-drop';
import './autosave';
import './required';
import './pagination';
import './selection';
