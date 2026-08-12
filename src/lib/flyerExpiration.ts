const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validateExpirationDate(expirationDate: string): void {
	if (!DATE_PATTERN.test(expirationDate)) {
		throw new Error(`Flyer expiration date must use YYYY-MM-DD; received "${expirationDate}".`);
	}

	const [year, month, day] = expirationDate.split('-').map(Number);
	const date = new Date(Date.UTC(year, month - 1, day));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		throw new Error(`Flyer expiration date must be a real YYYY-MM-DD date; received "${expirationDate}".`);
	}
}

function dateInTimeZone(date: Date, timeZone: string): string {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(date);
	const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
	return `${values.year}-${values.month}-${values.day}`;
}

export function getFlyerExpirationTime(
	expirationDate?: string,
	timeZone = 'America/Chicago',
): number | undefined {
	if (expirationDate === undefined) return undefined;
	validateExpirationDate(expirationDate);

	// Find the first millisecond whose local calendar date is later than the
	// configured date. Binary search avoids hardcoding UTC offsets or DST rules.
	const [year, month, day] = expirationDate.split('-').map(Number);
	let low = Date.UTC(year, month - 1, day) - 15 * 60 * 60 * 1000;
	let high = Date.UTC(year, month - 1, day) + 48 * 60 * 60 * 1000;

	// Constructing the formatter inside dateInTimeZone also validates the zone.
	dateInTimeZone(new Date(low), timeZone);
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if (dateInTimeZone(new Date(middle), timeZone) > expirationDate) {
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
	timeZone = 'America/Chicago',
): boolean {
	const expirationTime = getFlyerExpirationTime(expirationDate, timeZone);
	return expirationTime !== undefined && now.getTime() >= expirationTime;
}
