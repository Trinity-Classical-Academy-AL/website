/** URL-owned state shared by SSR overlays and the client navigation layer. */
export function dialogMatches(current: URL, open: URL): boolean {
	return current.origin === open.origin && current.pathname === open.pathname
		&& Array.from(open.searchParams).every(([key, value]) => current.searchParams.get(key) === value);
}

export function dialogAttributes(current: URL, options: {
	openUrl: string; closeUrl: string; hidden?: boolean;
}) {
	const open = new URL(options.openUrl, current);
	// Validation can render an open sheet on a POST without its query key.
	const fallback = options.hidden === false && !dialogMatches(current, open) ? current.href : undefined;
	return {
		hidden: !(dialogMatches(current, open) || fallback),
		'data-instant-dialog-url': open.pathname + open.search,
		'data-instant-dialog-close': options.closeUrl,
		'data-dialog-fallback-url': fallback,
	};
}

export function syncDialogs(root: ParentNode, current: URL) {
	root.querySelectorAll<HTMLElement>('[data-instant-dialog-url]').forEach(node => {
		const open = new URL(node.dataset.instantDialogUrl!, current);
		const hidden = !dialogMatches(current, open) && node.dataset.dialogFallbackUrl !== current.href;
		if (node.hidden !== hidden) node.hidden = hidden;
	});
}
