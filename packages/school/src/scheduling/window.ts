/** Inclusive last bookable date, calculated from the caller's Chicago date. */
export function bookingWindowEnd(today: string, days: number | null): string | null {
	if (days === null) return null;
	const date = new Date(`${today}T12:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

