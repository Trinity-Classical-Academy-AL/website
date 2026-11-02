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
		utc = Date.UTC(year, month - 1, day, hour, minute) - zoneOffset('America/Chicago', utc);
	}
	return new Date(utc).toISOString();
}

export function isoToChicagoInput(iso: string): string {
	if (!iso) return '';
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'America/Chicago',
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
		timeZone: 'America/Chicago',
		dateStyle: 'medium',
		...(withTime ? { timeStyle: 'short' as const } : {}),
	}).format(new Date(iso));
}
