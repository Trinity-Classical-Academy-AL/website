import type { TransitionBeforePreparationEvent } from 'astro:transitions/client';

/**
 * Links on a page are rendered for the URL the server saw. Local search and
 * client pagination then change the address bar with replaceState (`q`, `page`),
 * so a row or sheet link would drop them and reset the list. Every same-page
 * navigation (opening or closing a sheet, a dialog, a row) carries those
 * client-side changes forward, unless the link itself sets that param.
 */
let rendered = new URL(location.href);
let dialogOnly = false;

export function withClientState(target: URL, current = new URL(location.href), base = rendered): URL {
	if (target.origin !== current.origin || target.pathname !== current.pathname || base.pathname !== current.pathname) return target;
	const keys = new Set([...current.searchParams.keys(), ...base.searchParams.keys()]);
	let next: URL | undefined;
	for (const key of keys) {
		const now = current.searchParams.get(key), then = base.searchParams.get(key);
		// Unchanged since render, or the link chose its own value: leave it.
		if (now === then || target.searchParams.get(key) !== then) continue;
		next ??= new URL(target);
		if (now === null) next.searchParams.delete(key); else next.searchParams.set(key, now);
	}
	return next ?? target;
}

document.addEventListener('astro:before-preparation', (raw) => {
	const event = raw as TransitionBeforePreparationEvent;
	dialogOnly = !!event.info?.portalDialog;
	if (event.formData) return;
	const next = withClientState(event.to);
	if (next !== event.to) event.to = next;
});
// An instant dialog keeps the rendered links, so it keeps the rendered URL too.
document.addEventListener('astro:page-load', () => {
	if (!dialogOnly) rendered = new URL(location.href);
	dialogOnly = false;
});
