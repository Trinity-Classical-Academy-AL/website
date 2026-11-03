import { TOUR_DEFAULTS } from './defaults.ts';
import { chicagoToday, formatBannerWhen } from './dates.ts';

export type FlyerContentType = 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf';

export type BannerFlyer = {
	key: string;
	name: string;
	contentType: FlyerContentType;
	size: number;
};

export type BannerModal = {
	title: string;
	date: string;
	time: string;
	location: string;
	description: string;
	rsvpUrl: string;
	rsvpLabel: string;
	secondaryUrl: string;
	secondaryLabel: string;
};

export type Banner = {
	enabled: boolean;
	text: string;
	startsOn: string;
	endsOn: string;
	clickAction: 'url' | 'flyer';
	url: string;
	flyer: BannerFlyer | null;
	modal: BannerModal;
	updatedAt: string;
};

export type BannerDocument = {
	current: Banner;
	history: Banner[];
};

export function emptyModal(): BannerModal {
	return {
		title: '',
		date: '',
		time: '',
		location: '',
		description: '',
		rsvpUrl: '',
		rsvpLabel: 'RSVP',
		secondaryUrl: '',
		secondaryLabel: '',
	};
}

export function emptyBanner(): Banner {
	return {
		enabled: false,
		text: '',
		startsOn: '',
		endsOn: '',
		clickAction: 'flyer',
		url: '',
		flyer: null,
		modal: emptyModal(),
		updatedAt: '',
	};
}

export function emptyBannerDocument(): BannerDocument {
	return { current: emptyBanner(), history: [] };
}

/** Changes when the visitor-facing banner content changes. Dismissal stores this. */
export function bannerVersion(banner: Banner): string {
	const payload = JSON.stringify({
		text: banner.text,
		startsOn: banner.startsOn,
		endsOn: banner.endsOn,
		clickAction: banner.clickAction,
		url: banner.url,
		flyer: banner.flyer?.key ?? '',
		modal: banner.modal,
	});
	let hash = 5381;
	for (let index = 0; index < payload.length; index += 1) {
		hash = ((hash << 5) + hash) ^ payload.charCodeAt(index);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

export function isBannerActive(banner: Banner | null | undefined, now = new Date()): boolean {
	if (!banner?.enabled) return false;
	if (!banner.text.trim()) return false;
	const today = chicagoToday(now);
	if (banner.startsOn && today < banner.startsOn) return false;
	if (banner.endsOn && today > banner.endsOn) return false;
	return true;
}

export type PublicBanner = {
	active: boolean;
	version?: string;
	text?: string;
	clickAction?: 'url' | 'flyer';
	url?: string;
	flyer?: { contentType: FlyerContentType; name: string } | null;
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

export function toPublicBanner(banner: Banner, now = new Date()): PublicBanner {
	if (!isBannerActive(banner, now)) return { active: false };
	const openFlyer = banner.clickAction === 'flyer';
	return {
		active: true,
		version: bannerVersion(banner),
		text: banner.text.slice(0, TOUR_DEFAULTS.bannerTextMax),
		clickAction: banner.clickAction,
		url: banner.clickAction === 'url' ? banner.url : '',
		flyer: openFlyer && banner.flyer ? { contentType: banner.flyer.contentType, name: banner.flyer.name } : null,
		modal: {
			title: banner.modal.title,
			whenLabel: formatBannerWhen(banner.modal.date, banner.modal.time),
			location: banner.modal.location,
			description: banner.modal.description,
			rsvpUrl: banner.modal.rsvpUrl,
			rsvpLabel: banner.modal.rsvpLabel,
			secondaryUrl: banner.modal.secondaryUrl,
			secondaryLabel: banner.modal.secondaryLabel,
		},
	};
}

const FLYER_TYPES = new Set<FlyerContentType>(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);

export function sniffFlyer(bytes: Uint8Array, reported: string): FlyerContentType | null {
	const type = reported === 'image/jpg' ? 'image/jpeg' : reported;
	if (!FLYER_TYPES.has(type as FlyerContentType)) return null;
	const isPng =
		bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
	const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
	const isPdf =
		bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
	const isWebp =
		bytes.length > 12 &&
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50;
	if (type === 'image/png' && isPng) return type;
	if (type === 'image/jpeg' && isJpeg) return type;
	if (type === 'image/webp' && isWebp) return type;
	if (type === 'application/pdf' && isPdf) return type;
	return null;
}
