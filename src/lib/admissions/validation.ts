import {
	GRADE_VALUES,
	HEAR_ABOUT_VALUES,
	TOUR_DEFAULTS,
} from './defaults.ts';
import { isHhmm, isIsoDate } from './dates.ts';

export type FieldErrors = Record<string, string>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function asString(value: unknown): string {
	return typeof value === 'string' ? value : value == null ? '' : String(value);
}

export function phoneDigits(value: string): string {
	const digits = value.replace(/\D/g, '');
	if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
	return digits;
}

export function errorSummary(count: number): string {
	if (count === 1) return 'Please fix 1 field before sending. It is marked below.';
	return `Please fix ${count} fields before sending. Each one is marked below.`;
}

export function givenName(fullName: string): string {
	const first = fullName.trim().split(/\s+/)[0];
	return first || 'there';
}

function gradesOf(value: unknown): string[] {
	const raw = Array.isArray(value) ? value : asString(value).split(',');
	const seen = new Set<string>();
	for (const entry of raw) {
		const grade = asString(entry).trim();
		if (GRADE_VALUES.includes(grade as (typeof GRADE_VALUES)[number])) seen.add(grade);
	}
	return [...seen];
}

export type TourRequestInput = {
	parentName: string;
	email: string;
	phone: string;
	children: number;
	grades: string[];
	tourDateId: string;
	hearAbout: string;
	message: string;
};

export type InterestInput = {
	name: string;
	email: string;
	phone: string;
	message: string;
	pagePath: string;
};

export function isHoneypotTripped(input: Record<string, unknown>): boolean {
	return asString(input.company).trim().length > 0;
}

export function validateTourRequest(input: Record<string, unknown>): {
	errors: FieldErrors;
	value?: TourRequestInput;
} {
	const errors: FieldErrors = {};
	const parentName = asString(input.parentName).trim().replace(/\s+/g, ' ');
	if (!parentName) errors.parentName = 'Enter your name';
	else if (parentName.length > 120) errors.parentName = 'Enter a shorter name';

	const email = asString(input.email).trim();
	if (!email || email.length > 254 || !EMAIL.test(email)) {
		errors.email = 'Enter a valid email address like name@example.com';
	}

	const phone = phoneDigits(asString(input.phone));
	if (phone.length !== 10) errors.phone = 'Enter a 10-digit phone number';

	const childrenText = asString(input.children).trim();
	const children = childrenText ? Number(childrenText) : 0;
	if (childrenText && (!Number.isInteger(children) || children < 1 || children > 8)) {
		errors.children = 'Choose how many children';
	}

	const grades = gradesOf(input.grades);
	if (grades.length === 0) errors.grades = 'Enter at least one grade';

	const tourDateId = asString(input.tourDateId).trim();
	if (!tourDateId) errors.tourDateId = 'Choose at least one date';

	const hearAbout = asString(input.hearAbout).trim();
	if (hearAbout && !HEAR_ABOUT_VALUES.includes(hearAbout as (typeof HEAR_ABOUT_VALUES)[number])) {
		errors.hearAbout = 'Choose a listed option';
	}

	const message = asString(input.message).trim();
	if (message.length > 2000) errors.message = 'Keep the message under 2,000 characters';

	if (Object.keys(errors).length > 0) return { errors };
	return {
		errors,
		value: {
			parentName,
			email,
			phone,
			children,
			grades,
			tourDateId,
			hearAbout,
			message,
		},
	};
}

export function validateInterest(input: Record<string, unknown>): {
	errors: FieldErrors;
	value?: InterestInput;
} {
	const errors: FieldErrors = {};
	const name = asString(input.name).trim().replace(/\s+/g, ' ');
	if (!name) errors.name = 'Enter your name';
	else if (name.length > 120) errors.name = 'Enter a shorter name';

	const email = asString(input.email).trim();
	if (!email || email.length > 254 || !EMAIL.test(email)) {
		errors.email = 'Enter a valid email address like name@example.com';
	}

	const phoneRaw = asString(input.phone).trim();
	const phone = phoneRaw ? phoneDigits(phoneRaw) : '';
	if (phoneRaw && phone.length !== 10) errors.phone = 'Enter a 10-digit phone number';

	const message = asString(input.message).trim();
	if (message.length > 2000) errors.message = 'Keep the note under 2,000 characters';

	let pagePath = asString(input.pagePath).trim();
	if (!pagePath.startsWith('/')) pagePath = '/';
	pagePath = pagePath.slice(0, 200);

	if (Object.keys(errors).length > 0) return { errors };
	return { errors, value: { name, email, phone, message, pagePath } };
}

export function safeHttpUrl(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return '';
	if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.includes('\\')) return trimmed;
	try {
		const url = new URL(trimmed);
		if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
	} catch {
		return '';
	}
	return '';
}

export type BannerInput = {
	enabled: boolean;
	text: string;
	startsOn: string;
	endsOn: string;
	clickAction: 'url' | 'flyer';
	url: string;
	modal: {
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
};

export function validateBanner(input: Record<string, unknown>): { errors: FieldErrors; value?: BannerInput } {
	const errors: FieldErrors = {};
	const text = asString(input.text).trim().replace(/\s+/g, ' ');
	if (text.length > TOUR_DEFAULTS.bannerTextMax) {
		errors.text = `Keep the banner to ${TOUR_DEFAULTS.bannerTextMax} characters.`;
	}

	const startsOn = asString(input.startsOn).trim();
	const endsOn = asString(input.endsOn).trim();
	if (startsOn && !isIsoDate(startsOn)) errors.startsOn = 'Use a real date.';
	if (endsOn && !isIsoDate(endsOn)) errors.endsOn = 'Use a real date.';
	if (startsOn && endsOn && isIsoDate(startsOn) && isIsoDate(endsOn) && startsOn > endsOn) {
		errors.endsOn = 'The end date is before the start date.';
	}

	const clickAction = input.clickAction === 'url' ? 'url' : 'flyer';
	const url = safeHttpUrl(asString(input.url));
	if (clickAction === 'url' && asString(input.url).trim() && !url) {
		errors.url = 'Use a full http(s) link, or a path that starts with /.';
	}

	const modalInput = input.modal && typeof input.modal === 'object' ? (input.modal as Record<string, unknown>) : {};
	const modal = {
		title: asString(modalInput.title).trim().slice(0, 140),
		date: asString(modalInput.date).trim(),
		time: asString(modalInput.time).trim(),
		location: asString(modalInput.location).trim().slice(0, 200),
		description: asString(modalInput.description).trim().slice(0, 800),
		rsvpUrl: safeHttpUrl(asString(modalInput.rsvpUrl)),
		rsvpLabel: asString(modalInput.rsvpLabel).trim().slice(0, 40) || 'RSVP',
		secondaryUrl: safeHttpUrl(asString(modalInput.secondaryUrl)),
		secondaryLabel: asString(modalInput.secondaryLabel).trim().slice(0, 40),
	};
	if (modal.date && !isIsoDate(modal.date)) errors['modal.date'] = 'Use a real date.';
	if (modal.time && !isHhmm(modal.time)) errors['modal.time'] = 'Use a time like 19:00.';
	if (asString(modalInput.rsvpUrl).trim() && !modal.rsvpUrl) {
		errors['modal.rsvpUrl'] = 'Use a full http(s) link, or a path that starts with /.';
	}
	if (asString(modalInput.secondaryUrl).trim() && !modal.secondaryUrl) {
		errors['modal.secondaryUrl'] = 'Use a full http(s) link, or a path that starts with /.';
	}

	if (Object.keys(errors).length > 0) return { errors };
	return {
		errors,
		value: {
			enabled: input.enabled === true || input.enabled === 'true',
			text,
			startsOn,
			endsOn,
			clickAction,
			url,
			modal,
		},
	};
}
