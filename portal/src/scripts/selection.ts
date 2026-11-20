/**
 * Row selection for <DataTable selectable> + <SelectionBar>. Selection is kept per
 * page path in memory, so opening a sheet (a same-page navigation that swaps the
 * DOM) or paging keeps it. Both responsive copies of a table stay in sync.
 */
let path = location.pathname;
let selected = new Set<string>();

const boxes = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[data-select-row]'));
const visibleRow = (input: HTMLInputElement) => { const row = input.closest('tr'); return !!row && !row.hidden && !row.classList.contains('paged-out'); };

function paint() {
	for (const input of boxes()) {
		input.checked = selected.has(input.value);
		input.closest('tr')?.classList.toggle('is-selected', input.checked);
	}
	for (const all of document.querySelectorAll<HTMLInputElement>('input[data-select-all]')) {
		const table = all.closest('table');
		const onPage = Array.from(table?.querySelectorAll<HTMLInputElement>('input[data-select-row]') ?? []).filter(visibleRow);
		const count = onPage.filter((input) => selected.has(input.value)).length;
		all.checked = onPage.length > 0 && count === onPage.length;
		all.indeterminate = count > 0 && count < onPage.length;
	}
	for (const bar of document.querySelectorAll<HTMLElement>('[data-selbar]')) {
		const open = selected.size > 0;
		bar.toggleAttribute('data-open', open);
		bar.setAttribute('aria-hidden', String(!open));
		bar.querySelectorAll<HTMLElement>('button, a').forEach((control) => { control.tabIndex = open ? 0 : -1; });
		const count = bar.querySelector('[data-sel-count]');
		if (count) count.textContent = String(selected.size);
		bar.querySelectorAll<HTMLButtonElement>('button[data-selection-action]').forEach((button) => {
			button.disabled = selected.size < Number(button.dataset.min || 1);
		});
	}
}

document.addEventListener('change', (event) => {
	const input = event.target;
	if (!(input instanceof HTMLInputElement)) return;
	if (input.matches('[data-select-row]')) {
		if (input.checked) selected.add(input.value); else selected.delete(input.value);
		paint();
	} else if (input.matches('[data-select-all]')) {
		const rows = Array.from(input.closest('table')?.querySelectorAll<HTMLInputElement>('input[data-select-row]') ?? []).filter(visibleRow);
		for (const row of rows) if (input.checked) selected.add(row.value); else selected.delete(row.value);
		paint();
	}
});

document.addEventListener('click', (event) => {
	const target = event.target as Element;
	if (target.closest('[data-sel-clear]')) { selected.clear(); paint(); return; }
	const action = target.closest<HTMLButtonElement>('button[data-selection-action]');
	if (action && !action.disabled) {
		const url = new URL(action.dataset.selectionAction!, location.href);
		url.searchParams.set('ids', [...selected].join(','));
		location.assign(url.href);
	}
});

document.addEventListener('keydown', (event) => {
	if (event.key === 'Escape' && selected.size && !document.querySelector('.ov:not([hidden])')) { selected.clear(); paint(); }
});

// Paging and search change which rows the header checkbox covers.
new MutationObserver(() => { if (document.querySelector('[data-selbar]')) paintSoon(); }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
let queued = false;
function paintSoon() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; paint(); }); }

function restore() {
	if (location.pathname !== path) { path = location.pathname; selected = new Set(); }
	paint();
}
document.addEventListener('astro:after-swap', restore);
document.addEventListener('astro:page-load', restore);
paint();
