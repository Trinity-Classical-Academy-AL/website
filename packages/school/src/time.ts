/** School calendar dates and instants are interpreted in Chicago unless a zone is supplied.
 * Calendar-only labels use UTC to avoid shifting a date when formatting it.
 * Legacy parsers intentionally retain their existing permissive behavior.
 */
export const CHICAGO = 'America/Chicago';

function zoneOffset(timeZone: string, utcMs: number): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hour12: false,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	}).formatToParts(new Date(utcMs));
	const map: Record<string, string> = {};
	for (const part of parts) map[part.type] = part.value;
	const asUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour) % 24, Number(map.minute), Number(map.second));
	return asUtc - utcMs;
}

/** `datetime-local` value interpreted as America/Chicago. */
export function chicagoInputToIso(local: string): string {
	if (!local || !local.includes('T')) return '';
	const [date, time] = local.split('T');
	const [year, month, day] = date.split('-').map(Number);
	const [hour, minute] = time.split(':').map(Number);
	let utc = Date.UTC(year, month - 1, day, hour, minute);
	for (let pass = 0; pass < 2; pass += 1) {
		utc = Date.UTC(year, month - 1, day, hour, minute) - zoneOffset(CHICAGO, utc);
	}
	return new Date(utc).toISOString();
}

export function isoToChicagoInput(iso: string): string {
	if (!iso) return '';
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: CHICAGO,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	}).formatToParts(new Date(iso));
	const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
	return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export function formatChicago(iso: string, withTime = true): string {
	if (!iso) return '';
	return new Intl.DateTimeFormat('en-US', {
		timeZone: CHICAGO,
		dateStyle: 'medium',
		...(withTime ? { timeStyle: 'short' as const } : {}),
	}).format(new Date(iso));
}

export function eventDate(iso: string, withYear = true): string {
	return new Intl.DateTimeFormat('en-US', { timeZone: CHICAGO, weekday: 'long', month: 'long', day: 'numeric', ...(withYear ? { year: 'numeric' as const } : {}) }).format(new Date(iso));
}

export function eventClock(iso: string): string {
	return new Intl.DateTimeFormat('en-US', { timeZone: CHICAGO, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)).toLowerCase();
}

export function eventWhen(iso: string): string {
	return `${eventDate(iso)} · ${eventClock(iso)}`;
}

export function parseUsDate(value: string): string {
	const trimmed = value.trim();
	const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
	if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
	const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
	if (!us) return '';
	const month = Number(us[1]);
	const day = Number(us[2]);
	const year = Number(us[3]);
	if (month < 1 || month > 12 || day < 1 || day > 31) return '';
	const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
	const check = new Date(`${date}T00:00:00Z`);
	if (check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) return '';
	return date;
}

export function formatUsDate(iso: string): string {
	const [year, month, day] = iso.split('-');
	if (!year || !month || !day) return '';
	return `${month}/${day}/${year}`;
}

export function parseClock(value: string): string {
	const trimmed = value.trim();
	const spoken = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/.exec(trimmed);
	if (spoken) {
		let hour = Number(spoken[1]);
		if (hour < 1 || hour > 12) return '';
		const pm = spoken[3].toLowerCase() === 'pm';
		if (pm && hour !== 12) hour += 12;
		if (!pm && hour === 12) hour = 0;
		return `${String(hour).padStart(2, '0')}:${spoken[2]}`;
	}
	const plain = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(trimmed);
	return plain ? `${plain[1]}:${plain[2]}` : '';
}

export function longDate(iso: string): string {
	const [year, month, day] = iso.split('-').map(Number);
	return !year || !month || !day ? iso : formatLongDate(iso);
}

export function shortDate(iso: string): string {
	const [year, month, day] = iso.split('-').map(Number);
	if (!year || !month || !day) return iso;
	return calendarLabel(new Date(Date.UTC(year, month - 1, day)), true);
}

export function formatTourClock(value: string): string {
	const match = /^(\d{1,2}):(\d{2})/.exec(value);
	if (!match) return value;
	const clock = clockParts(Number(match[1]), match[2]);
	return `${clock.text} ${clock.suffix}`;
}

export function formatTourWhen(date: string, start: string, end: string): string {
	const [year, month, day] = date.split('-').map(Number);
	if (!year || !month || !day) return `${date} ${formatTourClock(start)}–${formatTourClock(end)}`;
	const label = formatLongDate(date);
	return `${label}, ${formatTourClock(start)}–${formatTourClock(end)}`;
}

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

export function chicagoToday(now = new Date(), timeZone = CHICAGO): string {
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

export function formatLongDate(iso: string): string {
	const [year, month, day] = iso.split('-').map(Number);
	return calendarLabel(new Date(Date.UTC(year, month - 1, day)), false);
}

export function formatMonthDay(iso: string): string {
	return iso ? formatLongDate(iso) : '';
}

function clockParts(hour: number, minute: string): { text: string; suffix: 'AM' | 'PM' } {
	return { text: `${hour % 12 || 12}:${minute}`, suffix: hour >= 12 ? 'PM' : 'AM' };
}

function formatClock(hhmm: string): { text: string; suffix: 'AM' | 'PM' } {
	const [hourRaw, minuteRaw] = hhmm.split(':').map(Number);
	return clockParts(hourRaw, pad(minuteRaw));
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

export function isHhmm(value: string): boolean {
	const match = /^(\d{2}):(\d{2})$/.exec(value);
	if (!match) return false;
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

/** Inclusive last bookable date, calculated from the caller's Chicago date. */
export function bookingWindowEnd(today: string, days: number | null): string | null {
	if (days === null) return null;
	const date = new Date(`${today}T12:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
	const [year, month, day] = iso.split('-').map(Number);
	return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function receivedLabel(iso: string): string {
	if (!iso) return '';
	return new Intl.DateTimeFormat('en-US', {
		timeZone: CHICAGO,
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	}).format(new Date(iso));
}

/** Short calendar label used by legacy admin and public visit lists (no year). */
export function shortDateWithoutYear(iso: string): string {
	const [year, month, day] = iso.split('-').map(Number);
	if (!year || !month || !day) return iso;
	return shortCalendarLabel(new Date(Date.UTC(year, month - 1, day)));
}

export function shortCalendarLabel(date: Date): string {
	return calendarLabel(date, true, false);
}

function calendarLabel(date: Date, short: boolean, withYear = true): string {
	return new Intl.DateTimeFormat('en-US', {
		weekday: short ? 'short' : 'long', month: short ? 'short' : 'long', day: 'numeric',
		...(withYear ? { year: 'numeric' as const } : {}), timeZone: 'UTC',
	}).format(date);
}

function validateExpirationDate(expirationDate: string): void {
	if (!ISO_DATE.test(expirationDate)) {
		throw new Error(`Flyer expiration date must use YYYY-MM-DD; received "${expirationDate}".`);
	}

	if (!isIsoDate(expirationDate)) {
		throw new Error(`Flyer expiration date must be a real YYYY-MM-DD date; received "${expirationDate}".`);
	}
}

export function getFlyerExpirationTime(
	expirationDate?: string,
	timeZone = CHICAGO,
): number | undefined {
	if (expirationDate === undefined) return undefined;
	validateExpirationDate(expirationDate);

	// Find the first millisecond whose local calendar date is later than the
	// configured date. Binary search avoids hardcoding UTC offsets or DST rules.
	const [year, month, day] = expirationDate.split('-').map(Number);
	let low = Date.UTC(year, month - 1, day) - 15 * 60 * 60 * 1000;
	let high = Date.UTC(year, month - 1, day) + 48 * 60 * 60 * 1000;

	// Constructing the formatter inside chicagoToday also validates the zone.
	chicagoToday(new Date(low), timeZone);
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if (chicagoToday(new Date(middle), timeZone) > expirationDate) {
			high = middle;
		} else {
			low = middle + 1;
		}
	}

	return low;
}

export function isFlyerExpired(
	expirationDate?: string,
	now = new Date(),
	timeZone = CHICAGO,
): boolean {
	const expirationTime = getFlyerExpirationTime(expirationDate, timeZone);
	return expirationTime !== undefined && now.getTime() >= expirationTime;
}
