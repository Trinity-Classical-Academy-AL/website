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
			if (note) note.textContent = link ? 'Clicking goes to the link.' : 'Clicking opens this popup:';
			const cue = scope.querySelector('[data-banner-node="pv-cue"]');
			if (cue) cue.textContent = link ? 'Learn more' : 'View details';
		}));
		scope.querySelector('[data-banner-node="title"]')?.addEventListener('input', (event) => { const node = scope.querySelector('[data-banner-node="pv-title"]'); if (node && event.target instanceof HTMLInputElement) node.textContent = event.target.value || 'Event title'; });
		scope.querySelector('[data-banner-node="location"]')?.addEventListener('input', (event) => { const node = scope.querySelector('[data-banner-node="pv-where"]'); if (node && event.target instanceof HTMLInputElement) node.textContent = event.target.value; });
		scope.querySelector('[data-banner-node="description"]')?.addEventListener('input', (event) => { const node = scope.querySelector('[data-banner-node="pv-desc"]'); if (node && event.target instanceof HTMLTextAreaElement) node.textContent = event.target.value; });
		scope.querySelector('[data-banner-node="remove-flyer"]')?.addEventListener('click', () => {
			const box = scope.querySelector('[data-banner-node="removeFlyer"]');
			if (box instanceof HTMLInputElement) box.checked = true;
			scope.querySelector('[data-banner-node="flyer-card"]')?.setAttribute('hidden', '');
		});
		scope.querySelector('[data-banner-node="flyer"]')?.addEventListener('change', (event) => {
			const input = event.target;
			const save = scope.querySelector('[data-banner-node="banner-save"]');
			const message = scope.querySelector<HTMLElement>('[data-banner-node="flyer-error"]');
			if (!(input instanceof HTMLInputElement) || !message) return;
			const file = input.files?.[0];
			if (!file) return;
			if (file.size > limit) {
				message.hidden = false;
				const span = message.querySelector('span');
				if (span) span.textContent = file.name + ' is too large. Files must be 10 MB or smaller.';
				if (save instanceof HTMLButtonElement) save.disabled = true;
				input.value = '';
			} else {
				message.hidden = true;
				if (save instanceof HTMLButtonElement) save.disabled = false;
				// Show the chosen file right away; it uploads when the banner is saved.
				const remove = scope.querySelector('[data-banner-node="removeFlyer"]');
				if (remove instanceof HTMLInputElement) remove.checked = false;
				const size = `${Math.max(1, Math.round(file.size / 1024))} KB · uploads when you save`;
				const card = scope.querySelector<HTMLElement>('[data-banner-node="flyer-card"]');
				const drop = scope.querySelector<HTMLElement>('[data-banner-node="flyer-drop"]');
				if (card) {
					card.hidden = false;
					const name = card.querySelector('.wb-file-t strong'), meta = card.querySelector('.wb-file-t .mute');
					if (name) name.textContent = file.name;
					if (meta) meta.textContent = size;
				} else if (drop) {
					drop.replaceChildren();
					const label = document.createElement('span'); label.className = 'btn btn-s btn-sm'; label.textContent = 'Change file';
					const text = document.createElement('span'); text.className = 'mute';
					const strong = document.createElement('strong'); strong.textContent = file.name;
					text.append(strong, ` · ${size}`);
					drop.append(label, text);
				}
			}
		});

	}
}
document.addEventListener('astro:page-load', bindPreviews);
bindPreviews();
