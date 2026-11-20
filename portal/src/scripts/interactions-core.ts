/** Helpers shared by the browser entry and the Node regression tests. */
export function navigationScrollMode(from: URL, to: URL, navigationType: string) {
	if (navigationType === 'traverse') return 'history';
	return from.pathname === to.pathname ? 'preserve' : 'top';
}

export const errorSelector = '.alert-err, .errm:not([hidden]), [data-interaction-error]';
export function responseError(doc: Document): string {
	return doc.querySelector(errorSelector)?.textContent?.trim() || '';
}

export function optimisticUpdate(form: HTMLFormElement, data: FormData): () => void {
	const undo: Array<() => void> = [];
	const root = form.ownerDocument;
	const target = form.dataset.optimisticTarget;
	const rows = target
		? Array.from(root.querySelectorAll<HTMLElement>('[data-row]')).filter(row => row.dataset.row === target)
		: [form.closest<HTMLElement>('[data-row]') || form];
	const rememberHidden = (node: HTMLElement) => {
		const hidden = node.hidden;
		undo.push(() => { node.hidden = hidden; });
		node.hidden = true;
	};
	for (const mode of (form.dataset.optimistic || '').split('|')) {
		if (mode === 'contacted') for (const row of rows) for (const node of row.querySelectorAll<HTMLElement>('[data-contacted]')) {
			const before = node.textContent;
			undo.push(() => { node.textContent = before; });
			node.textContent = form.dataset.contactedLabel || 'Contacted';
		}
		if (mode === 'toggle') for (const row of rows) for (const node of row.querySelectorAll<HTMLInputElement>('[data-toggle]')) {
			const checked = node.checked;
			const pressed = node.getAttribute('aria-pressed');
			undo.push(() => { node.checked = checked; if (pressed === null) node.removeAttribute('aria-pressed'); else node.setAttribute('aria-pressed', pressed); });
			if (node.tagName === 'INPUT') node.checked = !checked;
			else node.setAttribute('aria-pressed', String(pressed !== 'true'));
		}
		if (mode === 'remove') rows.forEach(rememberHidden);
		if (mode === 'append-note') {
			// Show the note at the top of the sheet's activity (both responsive copies) and clear the box.
			const note = String(data.get('note') || '').trim();
			const field = form.querySelector<HTMLTextAreaElement>('textarea[name="note"]');
			const typed = field?.value ?? '';
			if (field) { field.value = ''; undo.push(() => { field.value = typed; }); }
			for (const feed of root.querySelectorAll<HTMLElement>('[data-note-feed]')) {
				const item = root.createElement('li');
				const head = root.createElement('p'); head.className = 'feed-h';
				const kind = root.createElement('strong'); kind.textContent = 'Note';
				const meta = root.createElement('span'); meta.className = 'mute'; meta.textContent = `${form.dataset.noteBy || 'You'} · just now`;
				const body = root.createElement('p'); body.textContent = note;
				head.append(kind, meta); item.append(head, body); feed.prepend(item);
				undo.push(() => item.remove());
			}
			root.querySelectorAll<HTMLElement>('[data-note-empty]').forEach(rememberHidden);
		}
		if (mode === 'close-sheet') {
			// Both responsive copies must disappear; never depend on rewritten IDs.
			if (form.closest('.ov')) root.querySelectorAll<HTMLElement>('.ov').forEach(rememberHidden);
		}
		if (mode === 'publish' || mode === 'status' || mode.startsWith('status:')) {
			const published = data.has('publish') ? data.get('publish') === 'yes' : data.get('published') === 'on';
			const text = mode === 'publish' ? (published ? form.dataset.publishedLabel || 'Published' : form.dataset.unpublishedLabel || 'Draft')
				: mode === 'status' ? String(data.get('status') || '') : mode.slice(7);
			for (const row of rows) for (const badge of row.querySelectorAll<HTMLElement>('[data-status]')) {
				if (mode === 'publish' && badge.hasAttribute('data-publish-full')) continue;
				const before = form.dataset.statusValue ?? badge.textContent;
				const classes = badge.className;
				undo.push(() => { badge.textContent = before; badge.className = classes; });
				badge.textContent = text;
				if (badge.classList.contains('badge')) {
					badge.classList.remove('b-gray', 'b-gold', 'b-green');
					badge.classList.add(['published', 'sent', 'contacted', 'confirmed'].includes(text.toLowerCase()) ? 'b-green' : text.toLowerCase() === 'proposed' ? 'b-gold' : 'b-gray');
				}
			}
		}
	}
	return () => { undo.splice(0).reverse().forEach(restore => restore()); };
}

export function searchURL(form: HTMLFormElement, location: string): URL {
	const url = new URL(form.getAttribute('action') || location, location);
	// Keep tab and other query filters not represented by controls.
	for (const input of Array.from(form.elements) as HTMLInputElement[]) {
		if (!input.name || input.disabled || ['submit', 'button'].includes(input.type)) continue;
		if (['radio', 'checkbox'].includes(input.type) && !input.checked) continue;
		url.searchParams.delete(input.name);
	}
	for (const [key, value] of new FormData(form)) if (typeof value === 'string' && value) url.searchParams.append(key, value);
	url.hash = '';
	return url;
}

/** Retain the typed draft while applying the server's field-specific validation. */
export function applyValidation(form: HTMLFormElement, doc: Document) {
	const key = (form: HTMLFormElement, name: string) => form.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value || '';
	const incoming = Array.from(doc.querySelectorAll<HTMLFormElement>('form')).find(candidate => key(candidate, 'action') === key(form, 'action') && key(candidate, 'id') === key(form, 'id'));
	if (!incoming) return;
	form.querySelectorAll('[data-interaction-field-error]').forEach(node => node.remove());
	form.querySelectorAll('[data-interaction-invalid]').forEach(node => { node.classList.remove('bad'); node.removeAttribute('aria-invalid'); node.removeAttribute('data-interaction-invalid'); });
	for (const field of incoming.querySelectorAll<HTMLInputElement>('input.bad,textarea.bad,select.bad')) {
		const target = Array.from(form.querySelectorAll<HTMLInputElement>('[name]')).find(input => input.name === field.name);
		if (!target) continue;
		target.classList.add('bad'); target.setAttribute('aria-invalid', 'true'); target.dataset.interactionInvalid = '';
		const text = field.closest('.field')?.querySelector('.errm')?.textContent;
		if (text) {
			const error = form.ownerDocument.createElement('p'); error.className = 'errm'; error.dataset.interactionFieldError = ''; error.textContent = text;
			target.insertAdjacentElement('afterend', error);
		}
	}
}

/** POST once, apply the server response, and hand fresh HTML to ClientRouter.
 * A followed redirect is the revalidation GET. Failed/uncertain POSTs are never retried.
 */
export async function submitAndRevalidate(
	event: { to: URL; formData?: FormData; signal: AbortSignal; newDocument: Document },
	state: { form: HTMLFormElement; url: string },
	options: {
		headers: HeadersInit; document: Document; rollback: (message: string) => void;
		fetch?: typeof fetch; parse?: (html: string) => Document;
	},
): Promise<void> {
	const fetchResponse = options.fetch ?? fetch;
	const parse = options.parse ?? ((html: string) => new DOMParser().parseFromString(html, 'text/html'));
	let rejected: Document | undefined;
	try {
		const response = await fetchResponse(event.to.href, { method: 'POST', headers: options.headers, body: event.formData, signal: event.signal, credentials: 'same-origin' });
		const doc = parse(await response.text());
		const message = responseError(doc);
		if (message) rejected = doc;
		if (!response.ok || message) throw new Error(message || `Could not save (${response.status}). Check before trying again.`);
		if (!response.headers.get('content-type')?.includes('text/html') || !doc.querySelector('[name="astro-view-transitions-enabled"]')) {
			throw new Error('Your session may have expired. Check before trying again.');
		}
		if (response.redirected) event.to = new URL(response.url);
		doc.querySelectorAll('noscript').forEach(node => node.remove());
		event.newDocument = doc;
	} catch (error) {
		if (event.signal.aborted) return;
		options.rollback(error instanceof Error ? error.message : 'Could not save. Check your connection before trying again.');
		if (rejected) applyValidation(state.form, rejected);
		event.newDocument = options.document;
		event.to = new URL(state.url);
	}
}
