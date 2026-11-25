// Scope every preview to its responsive form; bundled initialization survives swaps.
function bindPreviews() {
	for (const form of document.querySelectorAll<HTMLFormElement>('[data-banner-form]')) {
		if (form.dataset.previewBound) continue;
		form.dataset.previewBound = 'true';
		const scope = form.closest<HTMLElement>('.bn')!;

		const text = scope.querySelector<HTMLInputElement>('[data-banner-node="text"]');
		const count = scope.querySelector('[data-banner-node="text-count"]');
		const preview = scope.querySelector('[data-banner-node="pv-text"]');
		const badge = scope.querySelector('[data-banner-node="pv-badge"]');
		const pv = scope.querySelector('[data-banner-node="pv"]');
		const enabled = scope.querySelector('[name=enabled]');
		const limit = 10 * 1024 * 1024;
		function paint() {
			if (!text || !count || !preview) return;
			preview.textContent = text.value || 'Your banner text appears here';
			count.textContent = text.value.length + ' / 120';
			count.classList.toggle('bad', text.value.length > 120);
			text.classList.toggle('bad', text.value.length > 120);
			const on = enabled instanceof HTMLInputElement && enabled.checked;
			if (badge) { badge.textContent = !text.value.trim() ? 'Not set' : on ? 'Live' : 'Hidden'; badge.className = 'badge ' + (on && text.value.trim() ? 'b-green' : 'b-gray'); }
			pv?.classList.toggle('off', !on);
		}
		text?.addEventListener('input', paint);
		enabled?.addEventListener('change', paint);
		scope.querySelectorAll('[name=clickAction]').forEach((input) => input.addEventListener('change', () => {
			const url = scope.querySelector('[name=clickAction]:checked');
			const link = url instanceof HTMLInputElement && url.value === 'url';
			scope.querySelector('[data-banner-link]')?.toggleAttribute('hidden', !link);
			scope.querySelectorAll('[data-banner-popup]').forEach((node) => node.toggleAttribute('hidden', link));
			const note = scope.querySelector('[data-banner-node="pv-note"]');
			if (note) note.textContent = link ? 'Clicking goes to the link.' : 'Click the banner to open the popup.';
			const cue = scope.querySelector('[data-banner-node="pv-cue"]');
			if (cue) cue.textContent = link ? 'Learn more' : 'View details';
		}));
		scope.querySelector('[data-banner-node="title"]')?.addEventListener('input', (event) => { const node = scope.querySelector('[data-banner-node="pv-title"]'); if (node && event.target instanceof HTMLInputElement) node.textContent = event.target.value || 'Event title'; });
		scope.querySelector('[data-banner-node="location"]')?.addEventListener('input', (event) => { const node = scope.querySelector('[data-banner-node="pv-where"]'); if (node && event.target instanceof HTMLInputElement) node.textContent = event.target.value; });
		scope.querySelector('[data-banner-node="description"]')?.addEventListener('input', (event) => { const node = scope.querySelector('[data-banner-node="pv-desc"]'); if (node && event.target instanceof HTMLTextAreaElement) node.textContent = event.target.value; });
		bindFlyer(scope, limit);

	}
}
document.addEventListener('astro:page-load', bindPreviews);
bindPreviews();

/**
 * The flyer box: empty → choose or drop a file; a file → thumbnail, Preview,
 * Replace, Remove; removed → Undo until Save. A new file previews right away
 * (object URL) in the box, the popup mock and the full-size dialog; it uploads
 * with the banner on Save. The saved flyer comes from /admin/website/flyer.
 */
function bindFlyer(scope: HTMLElement, limit: number) {
	const box = scope.querySelector<HTMLElement>('[data-fly]');
	const input = scope.querySelector<HTMLInputElement>('[data-banner-node="flyer"]');
	const remove = scope.querySelector<HTMLInputElement>('[data-banner-node="removeFlyer"]');
	const error = scope.querySelector<HTMLElement>('[data-banner-node="flyer-error"]');
	const save = scope.querySelector<HTMLButtonElement>('[data-banner-node="banner-save"]');
	const dialog = scope.querySelector<HTMLDialogElement>('[data-fly-dlg]');
	if (!box || !input || !remove) return;
	const savedImg = box.querySelector<HTMLImageElement>('[data-fly-img]')?.getAttribute('src') || '';
	const savedPdf = !box.querySelector('[data-fly-pdf]')?.hasAttribute('hidden');
	const savedName = box.querySelector('[data-fly-name]')?.textContent || '';
	const savedSize = box.querySelector('[data-fly-size]')?.textContent || '';
	const hadSaved = box.dataset.state === 'file';
	// What the flyer currently is: the saved one, a new pick, or none.
	let current: { src: string; pdf: boolean } | null = hadSaved ? { src: savedPdf ? '/admin/website/flyer' : savedImg, pdf: savedPdf } : null;
	let objectUrl = '';

	const paint = (state: 'empty' | 'file' | 'removed', name = '', size = '') => {
		box.dataset.state = state;
		box.querySelector('[data-fly-name]')!.textContent = name;
		box.querySelector('[data-fly-size]')!.textContent = size;
		const show = state === 'file' ? current : null;
		for (const holder of [box, scope.querySelector<HTMLElement>('[data-fly-pv]')]) {
			if (!holder) continue;
			const img = holder.querySelector<HTMLImageElement>('img');
			const pdf = holder.querySelector<HTMLElement>('.wb-fly-pdf');
			if (img) { img.hidden = !show || show.pdf; if (show && !show.pdf) img.src = show.src; }
			if (pdf) pdf.hidden = !show?.pdf;
			holder.querySelector<HTMLElement>('.fthumb')?.toggleAttribute('hidden', !!show);
		}
	};
	const fail = (message: string) => {
		if (error) { error.hidden = false; error.querySelector('span')!.textContent = message; }
		input.value = '';
	};
	const take = (file: File | undefined) => {
		if (!file) return;
		if (!/^(image\/(png|jpeg|webp)|application\/pdf)$/.test(file.type)) return fail(`${file.name} isn’t a JPG, PNG, WebP or PDF.`);
		if (file.size > limit) return fail(`${file.name} is too large. Files must be 10 MB or smaller.`);
		if (error) error.hidden = true;
		if (save) save.disabled = false;
		remove.checked = false;
		if (input.files?.[0] !== file) { const list = new DataTransfer(); list.items.add(file); input.files = list.files; }
		if (objectUrl) URL.revokeObjectURL(objectUrl);
		objectUrl = URL.createObjectURL(file);
		current = { src: objectUrl, pdf: file.type === 'application/pdf' };
		paint('file', file.name, `${Math.max(1, Math.round(file.size / 1024))} KB · uploads when you save`);
	};

	scope.addEventListener('click', (event) => {
		const target = event.target as Element;
		if (target.closest('[data-fly-pick]')) { input.click(); return; }
		if (target.closest('[data-fly-remove]')) {
			input.value = '';
			remove.checked = hadSaved;
			current = null;
			paint(hadSaved ? 'removed' : 'empty');
			return;
		}
		if (target.closest('[data-fly-restore]')) {
			remove.checked = false;
			current = { src: savedPdf ? '/admin/website/flyer' : savedImg, pdf: savedPdf };
			paint('file', savedName, savedSize);
			return;
		}
		// The banner in the preview opens the popup, as it does on the website (not when it goes to a link).
		if (target.closest('[data-fly-open]') && dialog && !linkMode(scope)) { openDialog(scope, dialog, current); return; }
		if (target.closest('[data-fly-close]') || target === dialog) dialog?.close();
	});
	input.addEventListener('change', () => take(input.files?.[0]));
	scope.querySelector('.pv-bar[data-fly-open]')?.addEventListener('keydown', (event) => {
		const key = (event as KeyboardEvent).key;
		if ((key === 'Enter' || key === ' ') && dialog && !linkMode(scope)) { event.preventDefault(); openDialog(scope, dialog, current); }
	});
	// Drag a file onto the box (empty or not) to use it.
	box.addEventListener('dragover', (event) => { event.preventDefault(); box.classList.add('over'); });
	box.addEventListener('dragleave', () => box.classList.remove('over'));
	box.addEventListener('drop', (event) => { event.preventDefault(); box.classList.remove('over'); take(event.dataTransfer?.files?.[0]); });
}

const linkMode = (scope: HTMLElement) => (scope.querySelector<HTMLInputElement>('[name=clickAction]:checked')?.value ?? 'flyer') === 'url';

/** Fill the dialog from the form as it stands, then open it. */
function openDialog(scope: HTMLElement, dialog: HTMLDialogElement, flyer: { src: string; pdf: boolean } | null) {
	const value = (node: string) => scope.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-banner-node="${node}"]`)?.value.trim() || '';
	const media = dialog.querySelector<HTMLElement>('[data-fly-media]')!;
	media.replaceChildren();
	if (flyer?.pdf) {
		const frame = document.createElement('iframe'); frame.src = flyer.src; frame.title = 'Flyer'; media.append(frame);
	} else if (flyer) {
		const img = document.createElement('img'); img.src = flyer.src; img.alt = value('title') || 'Flyer'; media.append(img);
	}
	media.hidden = !flyer;
	dialog.classList.toggle('no-media', !flyer);
	dialog.querySelector('[data-fly-dtitle]')!.textContent = value('title') || 'Event title';
	const date = value('date'), time = value('time');
	const when = date ? new Date(`${date}T${time || '12:00'}`) : null;
	dialog.querySelector('[data-fly-dwhen]')!.textContent = [when ? when.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) + (time ? `, ${when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : '') : '', value('location')].filter(Boolean).join(' · ');
	dialog.querySelector('[data-fly-ddesc]')!.textContent = value('description');
	const buttons = dialog.querySelector<HTMLElement>('[data-fly-dbtns]')!;
	buttons.replaceChildren();
	for (const [label, kind] of [[value('rsvpLabel') || 'RSVP', 'p'], [value('secondaryLabel'), 's']]) {
		if (!label) continue;
		const span = document.createElement('span'); span.className = `pm-btn ${kind}`; span.textContent = label; buttons.append(span);
	}
	dialog.showModal();
}
