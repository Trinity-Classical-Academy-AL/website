import { TOUR_DEFAULTS } from './defaults.ts';

import { chicagoToday, nthWeekdayOfMonth } from '@tca/school/time';
export { pad, isIsoDate, chicagoToday, nthWeekdayOfMonth, formatLongDate, formatMonthDay, formatTimeRange, formatBannerWhen, isHhmm } from '@tca/school/time';

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

export function spotsLabel(remaining: number): string {
	if (remaining <= 0) return 'Full';
	if (remaining === 1) return '1 spot left';
	return `${remaining} spots left`;
}
