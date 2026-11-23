import type { TransitionBeforePreparationEvent } from 'astro:transitions/client';

/**
 * Client pagination for every <DataTable>. The server renders all rows; CSS hides
 * rows past the first page before this runs, so there is no flash. Rows hidden by
 * local search ([hidden]) are skipped, and the page lives in the URL (`page`, or
 * the table's own key) so opening and closing a sheet keeps it.
 */
const BOX = '.tbox[data-page-size]';
// Params that change which rows a list shows. Changing one starts again at page 1;
// anything else (sheet, dialog, saved-row params) keeps the current page.
const LIST_PARAMS = ['tab', 'q', 'filter', 'type', 'received', 'contacted', 'prior', 'status', 'when'];

const rowsOf = (box: HTMLElement) => Array.from(box.querySelectorAll<HTMLTableRowElement>(':scope > table > tbody > tr'));
const keyOf = (box: HTMLElement) => box.dataset.pageKey || 'page';

function urlPage(box: HTMLElement) {
	const page = Number(new URL(location.href).searchParams.get(keyOf(box)));
	return Number.isInteger(page) && page > 0 ? page : 1;
}

/** Page numbers to show: first, last, current ±1, with gaps as null. */
function pageList(current: number, total: number) {
	const pages = new Set([1, total, current - 1, current, current + 1].filter((page) => page >= 1 && page <= total));
	const sorted = [...pages].sort((a, b) => a - b);
	return sorted.flatMap((page, index) => index && page - sorted[index - 1] > 1 ? [null, page] : [page]);
}

function render(box: HTMLElement, requested = urlPage(box)) {
	const size = Number(box.dataset.pageSize) || 25;
	const rows = rowsOf(box);
	const shown = rows.filter((row) => !row.hidden);
	const total = Math.max(1, Math.ceil(shown.length / size));
	const page = Math.min(Math.max(1, requested), total);
	rows.forEach((row) => row.classList.remove('paged-out'));
	shown.forEach((row, index) => { if (Math.floor(index / size) !== page - 1) row.classList.add('paged-out'); });
	box.dataset.paged = '';
	box.dataset.page = String(page);

	const nav = box.querySelector<HTMLElement>(':scope > .tpager');
	if (!nav) return;
	// The count always shows; page buttons only when there is more than one page.
	nav.hidden = shown.length === 0;
	if (nav.hidden) return;
	const start = (page - 1) * size + 1;
	nav.querySelector('[data-pager-count]')!.textContent = shown.length === 1 ? '1 row' : `${start}–${Math.min(page * size, shown.length)} of ${shown.length}`;
	nav.querySelector<HTMLElement>('.tpager-b')!.hidden = total === 1;
	if (total === 1) return;
	nav.querySelector<HTMLButtonElement>('[data-pager="prev"]')!.disabled = page === 1;
	nav.querySelector<HTMLButtonElement>('[data-pager="next"]')!.disabled = page === total;
	const list = nav.querySelector<HTMLElement>('[data-pager-pages]')!;
	list.replaceChildren(...pageList(page, total).map((item) => {
		if (item === null) { const gap = document.createElement('span'); gap.className = 'tpager-gap'; gap.textContent = '…'; return gap; }
		const button = document.createElement('button');
		button.type = 'button'; button.className = 'tpager-p'; button.textContent = String(item); button.dataset.pager = String(item);
		button.setAttribute('aria-label', `Page ${item}`);
		if (item === page) button.setAttribute('aria-current', 'page');
		return button;
	}));
}

function writeURL(box: HTMLElement, page: number) {
	const url = new URL(location.href);
	if (page > 1) url.searchParams.set(keyOf(box), String(page)); else url.searchParams.delete(keyOf(box));
	history.replaceState(history.state, '', url);
}

/** Move to a page in every copy of this table (desktop and phone layouts). */
function go(box: HTMLElement, page: number) {
	const key = keyOf(box);
	const boxes = Array.from(document.querySelectorAll<HTMLElement>(BOX)).filter((other) => keyOf(other) === key);
	boxes.forEach((other) => render(other, page));
	writeURL(box, Number(box.dataset.page));
	const top = box.getBoundingClientRect().top;
	if (top < 0) box.scrollIntoView({ block: 'start' });
}

const observed = new WeakSet<HTMLElement>();
function init() {
	document.querySelectorAll<HTMLElement>(BOX).forEach((box) => {
		// A just-saved row (.hl) opens on its own page.
		const saved = rowsOf(box).filter((row) => !row.hidden).findIndex((row) => row.classList.contains('hl'));
		render(box, saved >= 0 && !new URL(location.href).searchParams.has(keyOf(box)) ? Math.floor(saved / (Number(box.dataset.pageSize) || 25)) + 1 : urlPage(box));
		const body = box.querySelector('tbody');
		if (body && !observed.has(box)) {
			observed.add(box);
			// Optimistic deletes and inserts change the row count.
			new MutationObserver(() => render(box, Number(box.dataset.page))).observe(body, { childList: true });
		}
	});
}

document.addEventListener('click', (event) => {
	const button = (event.target as Element).closest<HTMLButtonElement>('.tpager button[data-pager]');
	const box = button?.closest<HTMLElement>(BOX);
	if (!button || !box || button.disabled) return;
	const page = Number(box.dataset.page);
	const target = button.dataset.pager === 'prev' ? page - 1 : button.dataset.pager === 'next' ? page + 1 : Number(button.dataset.pager);
	go(box, target);
});

// Local search hides rows; start again at page 1 of what matches.
document.addEventListener('input', (event) => {
	if (!(event.target instanceof HTMLInputElement) || event.target.name !== 'q' || !event.target.form?.hasAttribute('data-local-search')) return;
	// After the search handler has hidden rows (this module loads before it).
	setTimeout(() => {
		document.querySelectorAll<HTMLElement>(BOX).forEach((box) => render(box, 1));
		const url = new URL(location.href);
		document.querySelectorAll<HTMLElement>(BOX).forEach((box) => url.searchParams.delete(keyOf(box)));
		history.replaceState(history.state, '', url);
	});
});

// Same-page navigations that only open or close a sheet keep the current page.
document.addEventListener('astro:before-preparation', (raw) => {
	const event = raw as TransitionBeforePreparationEvent;
	// The router's `from` misses replaceState page changes; the address bar has them.
	const from = new URL(location.href), to = event.to;
	if (from.pathname !== to.pathname || LIST_PARAMS.some((key) => from.searchParams.get(key) !== to.searchParams.get(key))) return;
	const keys = [...from.searchParams.keys()].filter((key) => key === 'page' || key.startsWith('page-'));
	if (!keys.some((key) => !to.searchParams.has(key))) return;
	const next = new URL(to);
	for (const key of keys) if (!next.searchParams.has(key)) next.searchParams.set(key, from.searchParams.get(key)!);
	event.to = next;
});

init();
document.addEventListener('astro:page-load', init);
document.addEventListener('astro:after-swap', init);
