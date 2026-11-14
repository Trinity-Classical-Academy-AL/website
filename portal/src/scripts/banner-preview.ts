// Scope every preview to its responsive form; bundled initialization survives swaps.
function bindPreviews() {
	for (const form of document.querySelectorAll<HTMLFormElement>('[data-banner-form]')) {
		if (form.dataset.previewBound) continue;
		form.dataset.previewBound = 'true';
		const scope = form.closest<HTMLElement>('.bn')!;

		const text = scope.querySelector<HTMLTextAreaElement>('[data-banner-node="text"]');
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
			scope.querySelector('[data-banner-popup]')?.toggleAttribute('hidden', link);
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
			} else { message.hidden = true; if (save instanceof HTMLButtonElement) save.disabled = false; }
		});

	}
}
document.addEventListener('astro:page-load', bindPreviews);
bindPreviews();
