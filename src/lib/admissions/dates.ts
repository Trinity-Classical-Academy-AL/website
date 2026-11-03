import { TOUR_DEFAULTS } from './defaults.ts';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function pad(value: number): string {
	return String(value).padStart(2, '0');
}

export function isIsoDate(value: string): boolean {
	const match = ISO_DATE.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day
	);
}

export function chicagoToday(now = new Date(), timeZone = TOUR_DEFAULTS.timeZone): string {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(now);
	const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
	return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The nth weekday of a month. weekday: 0 Sunday … 6 Saturday. nth starts at 1. */
export function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): string {
	const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
	const day = 1 + ((weekday - firstDow + 7) % 7) + (nth - 1) * 7;
	const iso = `${year}-${pad(month)}-${pad(day)}`;
	if (!isIsoDate(iso) || day > 28 + 7) {
		throw new Error(`No weekday ${weekday} occurrence ${nth} in ${year}-${pad(month)}.`);
	}
	return iso;
}

/**
 * The school year tours are for. January–March 2027 tours are for 2027–28.
 * After the last tour month's date has passed, the next year's season is used.
 */
export function seasonYear(today: string, months: readonly number[] = TOUR_DEFAULTS.months): number {
	const year = Number(today.slice(0, 4));
	const month = Number(today.slice(5, 7));
	const day = Number(today.slice(8, 10));
	const lastMonth = Math.max(...months);
	if (month < lastMonth) return year;
	if (month > lastMonth) return year + 1;
	const lastDate = nthWeekdayOfMonth(year, lastMonth, TOUR_DEFAULTS.weekday, TOUR_DEFAULTS.nthWeekday);
	return day > Number(lastDate.slice(8, 10)) ? year + 1 : year;
}

export function schoolYearLabel(season: number): string {
	return `${season}–${String(season + 1).slice(-2)}`;
}

export type TourDateRecord = {
	id: string;
	date: string;
	capacity: number;
	startTime: string;
	endTime: string;
	enabled: boolean;
};

export function defaultTourDates(today = chicagoToday()): TourDateRecord[] {
	const year = seasonYear(today);
	return TOUR_DEFAULTS.months.map((month) => {
		const date = nthWeekdayOfMonth(year, month, TOUR_DEFAULTS.weekday, TOUR_DEFAULTS.nthWeekday);
		return {
			id: date,
			date,
			capacity: TOUR_DEFAULTS.capacity,
			startTime: TOUR_DEFAULTS.startTime,
			endTime: TOUR_DEFAULTS.endTime,
			enabled: true,
		};
	});
}

export function formatLongDate(iso: string): string {
	const [year, month, day] = iso.split('-').map(Number);
	return new Intl.DateTimeFormat('en-US', {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC',
	}).format(new Date(Date.UTC(year, month - 1, day)));
}

export function formatMonthDay(iso: string): string {
	if (!iso) return '';
	const [year, month, day] = iso.split('-').map(Number);
	return new Intl.DateTimeFormat('en-US', {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC',
	}).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatClock(hhmm: string): { text: string; suffix: 'AM' | 'PM' } {
	const [hourRaw, minuteRaw] = hhmm.split(':').map(Number);
	const suffix = hourRaw >= 12 ? 'PM' : 'AM';
	const hour = hourRaw % 12 || 12;
	const minute = pad(minuteRaw);
	return { text: `${hour}:${minute}`, suffix };
}

export function formatTimeRange(start: string, end: string): string {
	const from = formatClock(start);
	const to = formatClock(end);
	if (from.suffix === to.suffix) return `${from.text}–${to.text} ${from.suffix}`;
	return `${from.text} ${from.suffix}–${to.text} ${to.suffix}`;
}

export function formatBannerWhen(date: string, time: string): string {
	const dateLabel = date && isIsoDate(date) ? formatLongDate(date) : date;
	if (dateLabel && time && /^\d{2}:\d{2}$/.test(time)) {
		const clock = formatClock(time);
		return `${dateLabel} · ${clock.text} ${clock.suffix}`;
	}
	return [dateLabel, time].filter(Boolean).join(' · ');
}

export function spotsLabel(remaining: number): string {
	if (remaining <= 0) return 'Full';
	if (remaining === 1) return '1 spot left';
	return `${remaining} spots left`;
}

export function isHhmm(value: string): boolean {
	const match = /^(\d{2}):(\d{2})$/.exec(value);
	if (!match) return false;
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}
