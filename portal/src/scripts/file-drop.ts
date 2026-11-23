/**
 * <FileDrop>: show the chosen file (name and size) instead of the drop area,
 * accept a dragged file, and let Remove clear the choice. Everything is
 * delegated, so pages swapped in by the client router need no setup.
 */
const ROOT = '[data-file-drop]';

function size(bytes: number) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function render(root: HTMLElement) {
	const input = root.querySelector<HTMLInputElement>('.fdrop-in');
	const file = input?.files?.[0];
	root.classList.toggle('has-file', !!file);
	const card = root.querySelector<HTMLElement>('.fdrop-new');
	if (!card) return;
	card.hidden = !file;
	if (!file) return;
	card.querySelector('[data-file-name]')!.textContent = file.name;
	card.querySelector('[data-file-size]')!.textContent = size(file.size);
	root.querySelector('.drop')?.classList.remove('bad');
}

document.addEventListener('change', (event) => {
	const input = event.target;
	if (input instanceof HTMLInputElement && input.matches('.fdrop-in')) render(input.closest<HTMLElement>(ROOT)!);
});

document.addEventListener('click', (event) => {
	const clear = (event.target as Element).closest<HTMLButtonElement>('[data-file-clear]');
	const root = clear?.closest<HTMLElement>(ROOT);
	const input = root?.querySelector<HTMLInputElement>('.fdrop-in');
	if (!root || !input) return;
	input.value = '';
	render(root);
	root.querySelector<HTMLElement>('.drop')?.focus();
});

// Drag and drop onto the drop area (or the chosen-file card, to replace it).
let depth = 0;
const zone = (event: DragEvent) => (event.target as Element | null)?.closest?.<HTMLElement>(ROOT) ?? null;
document.addEventListener('dragenter', (event) => {
	const root = zone(event);
	if (!root || !event.dataTransfer?.types.includes('Files')) return;
	event.preventDefault(); depth++;
	root.classList.add('over');
});
document.addEventListener('dragover', (event) => {
	if (zone(event) && event.dataTransfer?.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }
});
document.addEventListener('dragleave', (event) => {
	const root = zone(event);
	if (!root) return;
	if (--depth <= 0) { depth = 0; root.classList.remove('over'); }
});
document.addEventListener('drop', (event) => {
	const root = zone(event);
	if (!root) return;
	event.preventDefault(); depth = 0;
	root.classList.remove('over');
	const input = root.querySelector<HTMLInputElement>('.fdrop-in');
	const files = event.dataTransfer?.files;
	if (!input || !files?.length) return;
	const transfer = new DataTransfer();
	transfer.items.add(files[0]);
	input.files = transfer.files;
	input.dispatchEvent(new Event('change', { bubbles: true }));
});

// A page restored from history can come back with a file still chosen.
document.addEventListener('astro:page-load', () => document.querySelectorAll<HTMLElement>(ROOT).forEach(render));
