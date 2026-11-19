/** A cancellable delay: only client navigations can start a loading state. */
export function delayedSkeleton(show: () => () => void, delay = 150) {
	let restore: (() => void) | undefined;
	const timer = setTimeout(() => { restore = show(); }, delay);
	return () => { clearTimeout(timer); restore?.(); restore = undefined; };
}

/** Measure the rendered layout rather than guessing table columns or row heights.
 * The original tree stays mounted, preserving drafts, focus and scroll on abort.
 */
export function showPageSkeleton(doc: Document) {
	const undo: Array<() => void> = [];
	for (const scope of doc.querySelectorAll<HTMLElement>('.awrap')) {
		if (!scope.getClientRects().length) continue;
		const template = doc.querySelector<HTMLTemplateElement>('[data-page-skeleton]');
		const overlay = template?.content.firstElementChild?.cloneNode(true) as HTMLElement | undefined;
		if (!overlay) continue;
		const box = scope.getBoundingClientRect();
		const tables = new Map<Element, { node: HTMLElement; box: DOMRect }>();
		const shape = (rect: DOMRect, line = false, height = 14, table?: Element | null) => {
			const group = table ? tables.get(table) : undefined;
			const origin = group?.box || box;
			const inset = group && !line ? 12 : 0;
			if (!rect.width || !rect.height) return;
			const node = doc.createElement('span');
			node.className = line ? 'skeleton-rule' : 'skeleton-shape';
			Object.assign(node.style, { left: `${rect.left - origin.left + inset}px`, top: `${rect.top - origin.top + (line ? rect.height - 1 : Math.max(0, (rect.height - height) / 2))}px`, width: `${line ? rect.width : Math.min(Math.max(0, rect.width - inset * 2) * .72, 260)}px`, height: `${line ? 1 : Math.min(rect.height, height)}px` });
			(group?.node || overlay).append(node);
		};
		for (const table of scope.querySelectorAll<HTMLElement>('.tbox')) {
			if (!table.getClientRects().length) continue;
			const rect = table.getBoundingClientRect();
			const frame = doc.createElement('div'); frame.className = 'skeleton-table';
			Object.assign(frame.style, { left: `${rect.left - box.left}px`, top: `${rect.top - box.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
			overlay.append(frame); tables.set(table, { node: frame, box: rect });
		}
		for (const node of scope.querySelectorAll<HTMLElement>('.ahead h1, .ahead p, .tabs a, .ptabs a, [role="tab"], .tbox th, .tbox td, .card-h h2, .card > p, .r .h3, .r .mute, .empty p')) {
			if (node.getClientRects().length && !node.closest('[hidden]')) shape(node.getBoundingClientRect(), false, node.tagName === 'H1' ? 32 : 14, node.closest('.tbox'));
		}
		for (const row of scope.querySelectorAll<HTMLElement>('.tbox tr')) {
			if (row.getClientRects().length && !row.closest('[hidden]')) shape(row.getBoundingClientRect(), true, 1, row.closest('.tbox'));
		}
		const busy = scope.getAttribute('aria-busy');
		scope.setAttribute('aria-busy', 'true');
		scope.classList.add('portal-loading'); scope.append(overlay);
		undo.push(() => {
			overlay.remove(); scope.classList.remove('portal-loading');
			if (busy === null) scope.removeAttribute('aria-busy'); else scope.setAttribute('aria-busy', busy);
		});
	}
	return () => undo.forEach(restore => restore());
}

export function showSheetSkeleton(doc: Document) {
	const template = doc.querySelector<HTMLTemplateElement>('[data-sheet-skeleton]');
	const nodes: Element[] = [];
	for (const shell of doc.querySelectorAll<HTMLElement>('.shell-d, .shell-m')) {
		if (!shell.getClientRects().length || !template) continue;
		const overlay = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
		shell.append(overlay); nodes.push(overlay);
	}
	return () => nodes.forEach(node => node.remove());
}
