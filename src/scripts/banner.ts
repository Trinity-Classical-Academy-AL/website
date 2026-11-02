import { TOUR_DEFAULTS } from '../lib/admissions/defaults.ts';

type PublicBanner = {
	active: boolean;
	version?: string;
	text?: string;
	clickAction?: 'url' | 'flyer';
	url?: string;
	flyer?: { contentType: string; name: string } | null;
	modal?: {
		title: string;
		whenLabel: string;
		location: string;
		description: string;
		rsvpUrl: string;
		rsvpLabel: string;
		secondaryUrl: string;
		secondaryLabel: string;
	};
};

const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800" viewBox="0 0 640 800">
<rect width="640" height="800" fill="#002A1A"/>
<text x="320" y="180" text-anchor="middle" fill="#DEA06D" font-family="Georgia" font-size="18" letter-spacing="3">TRINITY CLASSICAL ACADEMY</text>
<text x="320" y="340" text-anchor="middle" fill="#F0E9D0" font-family="Georgia" font-size="54">New Family</text>
<text x="320" y="410" text-anchor="middle" fill="#F0E9D0" font-family="Georgia" font-size="54">Information Night</text>
<text x="320" y="500" text-anchor="middle" fill="#DEA06D" font-family="Georgia" font-size="22">THURSDAY, JANUARY 21</text>
<text x="320" y="540" text-anchor="middle" fill="#F0E9D0" font-family="Georgia" font-size="28">7:00 PM</text>
</svg>`;

function sampleBanner(kind: 'sample' | 'pdf'): PublicBanner {
	return {
		active: true,
		version: kind === 'pdf' ? 'preview-pdf' : 'preview-sample',
		text: 'New Family Info Night · Thursday, January 21 · 7:00 PM',
		clickAction: 'flyer',
		url: '',
		flyer: { contentType: kind === 'pdf' ? 'application/pdf' : 'image/svg+xml', name: 'info-night-flyer.png' },
		modal: {
			title: 'New Family Information Night',
			whenLabel: 'Thursday, January 21, 2027 · 7:00 PM',
			location: '7160 Cahaba Valley Rd., Birmingham, AL 35242',
			description:
				'Meet our teachers and board, hear how a classical Christian education is shaped at Trinity, and ask your questions about admissions and tuition.',
			rsvpUrl: 'https://trinityclassical.academy/contact/',
			rsvpLabel: 'RSVP',
			secondaryUrl: '/visit',
			secondaryLabel: 'Request a tour',
		},
	};
}

function focusable(dialog: HTMLElement): HTMLElement[] {
	return [...dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])')].filter(
		(element) => !element.hasAttribute('hidden'),
	);
}

export function initAnnouncementBanner() {
	const root = document.querySelector<HTMLElement>('[data-announcement]');
	if (!root) return;
	const bar = root.querySelector<HTMLElement>('[data-banner-bar]');
	const trigger = root.querySelector<HTMLElement>('[data-banner-trigger]');
	const dismiss = root.querySelector<HTMLButtonElement>('[data-banner-dismiss]');
	const dialog = root.querySelector<HTMLElement>('[data-banner-modal]');
	const close = root.querySelector<HTMLButtonElement>('[data-banner-close]');
	if (!bar || !trigger || !dismiss || !dialog || !close) return;

	const params = new URLSearchParams(location.search);
	const previewKind = document.documentElement.dataset.previewStates === 'true' ? params.get('banner') : null;
	let lastFocus: HTMLElement | null = null;
	let banner: PublicBanner | null = null;

	const render = (next: PublicBanner) => {
		banner = next;
		if (!next.active || !next.version || !next.text) {
			root.remove();
			return;
		}
		try {
			if (localStorage.getItem(TOUR_DEFAULTS.dismissalStorageKey) === next.version) {
				root.remove();
				return;
			}
		} catch {
			/* private mode can throw; still show the banner */
		}

		trigger.textContent = next.text;
		const openFlyer = next.clickAction === 'flyer';
		if (!openFlyer && next.url) {
			trigger.setAttribute('href', next.url);
			if (next.url.startsWith('http')) {
				trigger.setAttribute('target', '_blank');
				trigger.setAttribute('rel', 'noopener noreferrer');
			}
		} else {
			trigger.setAttribute('href', '#event-details');
			trigger.setAttribute('aria-haspopup', 'dialog');
		}

		const title = dialog.querySelector<HTMLElement>('[data-modal-title]');
		const when = dialog.querySelector<HTMLElement>('[data-modal-when]');
		const where = dialog.querySelector<HTMLElement>('[data-modal-where]');
		const description = dialog.querySelector<HTMLElement>('[data-modal-description]');
		const media = dialog.querySelector<HTMLElement>('[data-modal-media]');
		const primary = dialog.querySelector<HTMLAnchorElement>('[data-modal-primary]');
		const secondary = dialog.querySelector<HTMLAnchorElement>('[data-modal-secondary]');
		if (title) title.textContent = next.modal?.title || 'Upcoming event';
		if (when) when.textContent = next.modal?.whenLabel || '';
		if (where) where.textContent = next.modal?.location || '';
		if (description) description.textContent = next.modal?.description || '';
		if (primary) {
			if (next.modal?.rsvpUrl) {
				primary.hidden = false;
				primary.href = next.modal.rsvpUrl;
				primary.textContent = next.modal.rsvpLabel || 'RSVP';
			} else primary.hidden = true;
		}
		if (secondary) {
			if (next.modal?.secondaryUrl) {
				secondary.hidden = false;
				secondary.href = next.modal.secondaryUrl;
				secondary.textContent = next.modal.secondaryLabel || 'Request a tour';
			} else secondary.hidden = true;
		}
		if (media) {
			media.replaceChildren();
			if (next.flyer?.contentType === 'application/pdf') {
				const frame = document.createElement('iframe');
				frame.title = next.modal?.title || 'Event flyer';
				frame.className = 'h-[70vh] w-full max-w-[420px] bg-white shadow-2xl sm:h-[80vh]';
				frame.src = previewKind === 'pdf' ? '' : '/api/banner/flyer';
				media.append(frame);
			} else if (next.flyer) {
				const image = document.createElement('img');
				image.alt = next.modal?.title || 'Event flyer';
				image.className = 'max-h-[70vh] w-auto max-w-full object-contain shadow-2xl sm:max-h-[80vh]';
				image.src = previewKind === 'sample' ? '' : '/api/banner/flyer';
				media.append(image);
			}
		}
		bar.hidden = false;
	};

	const open = () => {
		if (!dialog || banner?.clickAction !== 'flyer') return;
		lastFocus = trigger;
		dialog.hidden = false;
		dialog.classList.remove('hidden');
		dialog.classList.add('flex');
		dialog.setAttribute('aria-hidden', 'false');
		document.body.style.overflow = 'hidden';
		close.focus();
	};

	const shut = () => {
		dialog.hidden = true;
		dialog.classList.add('hidden');
		dialog.classList.remove('flex');
		dialog.setAttribute('aria-hidden', 'true');
		document.body.style.overflow = '';
		lastFocus?.focus();
		lastFocus = null;
	};

	trigger.addEventListener('click', (event) => {
		if (banner?.clickAction === 'flyer') {
			event.preventDefault();
			open();
		}
	});
	dismiss.addEventListener('click', () => {
		if (!banner?.version) return;
		try {
			localStorage.setItem(TOUR_DEFAULTS.dismissalStorageKey, banner.version);
		} catch {
			/* still hide it for this view */
		}
		shut();
		root.remove();
	});
	close.addEventListener('click', shut);
	dialog.addEventListener('click', (event) => {
		if (event.target === dialog) shut();
	});
	document.addEventListener('keydown', (event) => {
		if (dialog.hidden) return;
		if (event.key === 'Escape') {
			event.stopPropagation();
			shut();
			return;
		}
		if (event.key !== 'Tab') return;
		const items = focusable(dialog);
		if (items.length === 0) return;
		const first = items[0];
		const last = items[items.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	});

	const paintPreviewMedia = () => {
		const media = dialog.querySelector<HTMLElement>('[data-modal-media]');
		if (!media) return;
		if (previewKind === 'sample') {
			const image = media.querySelector('img');
			if (image) image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SAMPLE_SVG)}`;
		}
		if (previewKind === 'pdf') {
			const frame = media.querySelector('iframe');
			const blob = new Blob([previewPdf()], { type: 'application/pdf' });
			if (frame) frame.src = URL.createObjectURL(blob);
		}
	};

	if (previewKind === 'sample' || previewKind === 'pdf') {
		render(sampleBanner(previewKind));
		paintPreviewMedia();
		if (params.get('banner-open') === '1') open();
		return;
	}

	fetch('/api/banner', { headers: { accept: 'application/json' } })
		.then((response) => (response.ok ? response.json() : { active: false }))
		.then((payload: PublicBanner) => {
			render(payload);
		})
		.catch(() => {
			root.remove();
		});
}

function previewPdf(): ArrayBuffer {
	const source = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 420 640]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 118>>stream
BT /F1 18 Tf 48 560 Td (Trinity Classical Academy) Tj ET
BT /F1 22 Tf 48 500 Td (New Family Information Night) Tj ET
BT /F1 14 Tf 48 460 Td (Thursday, January 21, 7:00 PM) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`;
	return new TextEncoder().encode(source).buffer as ArrayBuffer;
}
