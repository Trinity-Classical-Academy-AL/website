// Labels and values shared by the existing tour time sheet and Times rows.
export const TOUR_BOOKING_WINDOWS = [
	['14', '2 weeks'], ['31', '1 month'], ['61', '2 months'],
	['92', '3 months'], ['183', '6 months'], ['', 'No limit'],
] as const;
export function tourBookingWindowLabel(days: number | null): string {
	if (days === null) return 'no booking limit';
	const label = TOUR_BOOKING_WINDOWS.find(([value]) => value === String(days))?.[1] ?? `${days} days`;
	return `bookable ${label} ahead`;
}
