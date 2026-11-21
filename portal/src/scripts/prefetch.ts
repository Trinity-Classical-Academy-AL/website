// @ts-expect-error Astro provides the same adapter virtual module to ClientRouter.
import { internalFetchHeaders } from 'virtual:astro:adapter-config/client';
import type { TransitionBeforePreparationEvent } from 'astro:transitions/client';

/**
 * Instant navigation: when someone points at a link or a clickable table row
 * (or starts a tap), fetch that page; if they follow it within a few seconds,
 * the client router shows the fetched page instead of asking again.
 *
 * Portal pages are private and always revalidated, so the browser's own
 * prefetch never gets reused. This keeps a short-lived copy in memory instead.
 * Anything that changes data (a form submission) clears every copy first, so a
 * prefetched page is never staler than the last thing the person did.
 */
const TTL = 15_000;
const INTENT_DELAY = 70;
const cache = new Map<string, { at: number; html: Promise<string | null> }>();
// Downloads, sign-in hand-offs and endpoints are never worth (or safe) fetching early.
const SKIP = /^\/(auth|dev|api|sign-out|verify|reset|setup)(\/|$)|export|\/file$|\.(csv|pdf)$/;

function keyFor(href: string): string | null {
	const url = new URL(href, location.href);
	url.hash = '';
	if (url.origin !== location.origin || SKIP.test(url.pathname)) return null;
	if (url.pathname === location.pathname && url.search === location.search) return null;
	return url.href;
}

function warm(href: string) {
	const key = keyFor(href);
	if (!key) return;
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < TTL) return;
	const html = fetch(key, { headers: { ...internalFetchHeaders, accept: 'text/html' }, credentials: 'same-origin' })
		.then((response) => {
			const type = response.headers.get('content-type') || '';
			return response.ok && !response.redirected && type.includes('text/html') ? response.text() : null;
		})
		.catch(() => null);
	cache.set(key, { at: Date.now(), html });
}

function targetOf(node: EventTarget | null): string | null {
	if (!(node instanceof Element)) return null;
	const anchor = node.closest<HTMLAnchorElement>('a[href]');
	if (anchor) {
		if (anchor.hasAttribute('download') || anchor.target || anchor.hasAttribute('data-astro-reload') || anchor.dataset.astroPrefetch === 'false') return null;
		return anchor.href;
	}
	return node.closest<HTMLElement>('tr[data-href]')?.dataset.href ?? null;
}

let timer: number | undefined;
document.addEventListener('pointerover', (event) => {
	if (event.pointerType !== 'mouse') return;
	const href = targetOf(event.target);
	window.clearTimeout(timer);
	if (href) timer = window.setTimeout(() => warm(href), INTENT_DELAY);
}, { passive: true });
document.addEventListener('pointerout', () => window.clearTimeout(timer), { passive: true });
// Touch and pen: the tap itself is the intent, and the fetch starts ~100 ms before the click lands.
document.addEventListener('pointerdown', (event) => {
	const href = targetOf(event.target);
	if (href) warm(href);
}, { passive: true });
document.addEventListener('focusin', (event) => {
	const href = targetOf(event.target);
	if (href && (event.target as Element).matches(':focus-visible')) warm(href);
});

// Any change to data makes every prefetched copy suspect.
document.addEventListener('submit', () => cache.clear(), true);

document.addEventListener('astro:before-preparation', (raw) => {
	const event = raw as TransitionBeforePreparationEvent;
	if (event.formData) { cache.clear(); return; }
	if (event.info?.portalDialog) return;
	const key = keyFor(event.to.href);
	const hit = key ? cache.get(key) : undefined;
	if (!key || !hit) return;
	cache.delete(key);
	if (Date.now() - hit.at > TTL) return;
	const original = event.loader;
	event.loader = async () => {
		const html = await hit.html;
		if (html == null || event.signal.aborted) return original();
		const doc = new DOMParser().parseFromString(html, 'text/html');
		doc.querySelectorAll('noscript').forEach((el) => el.remove());
		// A page without the client router needs a full load, which the original loader arranges.
		if (!doc.querySelector('[name="astro-view-transitions-enabled"]')) return original();
		event.newDocument = doc;
	};
});
