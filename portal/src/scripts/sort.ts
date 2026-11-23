/**
 * Sortable columns for every list table. A header with a `.th-sort` button sorts
 * its column: first click ascending, then descending, then back to the server's
 * order. A cell can give its own value in `data-sort` (a timestamp, a rank);
 * otherwise its text is used. A column sorts as numbers when all its values are
 * numbers, as dates when all are dates, and as text otherwise. Empty cells go last.
 * The sort lives in the URL (`sort`, or `sort-<pageKey>`) so opening a sheet,
 * a reload or a shared link keeps it. Both layout copies of a table move together.
 */
const TABLE = 'table[data-sortable]';
const MONTH = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b|^\d{4}-\d{2}-\d{2}/i;
const NUMBER = /^[-+]?\$?\d[\d,]*(\.\d+)?%?$/;
const EMPTY = new Set(['', '—', '-', '–']);

type Sort = { column: string; desc: boolean } | null;

const keyOf = (table: HTMLTableElement) => {
	const page = table.closest<HTMLElement>('.tbox')?.dataset.pageKey || 'page';
	return page === 'page' ? 'sort' : `sort-${page.replace(/^page-/, '')}`;
};
const bodyRows = (table: HTMLTableElement) => Array.from(table.tBodies[0]?.rows ?? []);
const headers = (table: HTMLTableElement) => Array.from(table.tHead?.rows[0]?.cells ?? []) as HTMLTableCellElement[];

function readSort(table: HTMLTableElement): Sort {
	const raw = new URL(location.href).searchParams.get(keyOf(table));
	if (!raw) return null;
	const desc = raw.startsWith('-');
	return { column: desc ? raw.slice(1) : raw, desc };
}

function cellValue(row: HTMLTableRowElement, index: number): string {
	const cell = row.cells[index];
	if (!cell) return '';
	return (cell.dataset.sort ?? cell.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function comparer(values: string[]): (a: string, b: string) => number {
	const present = values.filter((value) => !EMPTY.has(value));
	const numeric = present.length > 0 && present.every((value) => NUMBER.test(value));
	const dates = !numeric && present.length > 0 && present.every((value) => MONTH.test(value) && !Number.isNaN(Date.parse(value.replace(/·/g, ' '))));
	if (numeric) return (a, b) => Number(a.replace(/[$,%+]/g, '')) - Number(b.replace(/[$,%+]/g, ''));
	if (dates) return (a, b) => Date.parse(a.replace(/·/g, ' ')) - Date.parse(b.replace(/·/g, ' '));
	const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
	return (a, b) => collator.compare(a, b);
}

function apply(table: HTMLTableElement, sort: Sort) {
	const body = table.tBodies[0];
	if (!body) return;
	const rows = bodyRows(table);
	// Remember the server's order once, so a third click can restore it.
	rows.forEach((row, index) => { row.dataset.order ??= String(index); });
	const cells = headers(table);
	const index = sort ? cells.findIndex((cell) => cell.dataset.sortKey === sort.column) : -1;
	cells.forEach((cell, at) => {
		if (!cell.dataset.sortKey) return;
		if (at === index) cell.setAttribute('aria-sort', sort!.desc ? 'descending' : 'ascending');
		else cell.removeAttribute('aria-sort');
	});
	// Rows that span the whole table (an empty message) stay where they are.
	const movable = rows.filter((row) => row.cells.length > 1);
	let ordered: HTMLTableRowElement[];
	if (index < 0) ordered = [...movable].sort((a, b) => Number(a.dataset.order) - Number(b.dataset.order));
	else {
		const values = new Map(movable.map((row) => [row, cellValue(row, index)]));
		const compare = comparer([...values.values()]);
		ordered = [...movable].sort((a, b) => {
			const left = values.get(a)!, right = values.get(b)!;
			const emptyA = EMPTY.has(left), emptyB = EMPTY.has(right);
			if (emptyA || emptyB) return emptyA === emptyB ? Number(a.dataset.order) - Number(b.dataset.order) : emptyA ? 1 : -1;
			return (sort!.desc ? -compare(left, right) : compare(left, right)) || Number(a.dataset.order) - Number(b.dataset.order);
		});
	}
	if (ordered.every((row, at) => movable[at] === row)) return;
	// One DOM move per row; pagination re-renders from the new order.
	const fragment = document.createDocumentFragment();
	ordered.forEach((row) => fragment.append(row));
	body.prepend(fragment);
}

function init() {
	document.querySelectorAll<HTMLTableElement>(TABLE).forEach((table) => apply(table, readSort(table)));
}

document.addEventListener('click', (event) => {
	const button = (event.target as Element).closest<HTMLButtonElement>('.th-sort');
	const header = button?.closest<HTMLTableCellElement>('th[data-sort-key]');
	const table = header?.closest<HTMLTableElement>(TABLE);
	if (!header || !table) return;
	const current = readSort(table);
	const column = header.dataset.sortKey!;
	const next: Sort = current?.column !== column ? { column, desc: false } : !current.desc ? { column, desc: true } : null;
	const key = keyOf(table);
	const url = new URL(location.href);
	if (next) url.searchParams.set(key, `${next.desc ? '-' : ''}${column}`); else url.searchParams.delete(key);
	// A new order starts at the first page.
	const pageKey = table.closest<HTMLElement>('.tbox')?.dataset.pageKey || 'page';
	url.searchParams.delete(pageKey);
	history.replaceState(history.state, '', url);
	document.querySelectorAll<HTMLTableElement>(TABLE).forEach((other) => {
		if (keyOf(other) !== key) return;
		const box = other.closest<HTMLElement>('.tbox');
		if (box?.dataset.page) box.dataset.page = '1';
		apply(other, next);
	});
});

init();
document.addEventListener('astro:page-load', init);
document.addEventListener('astro:after-swap', init);
