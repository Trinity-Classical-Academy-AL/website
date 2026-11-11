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
	if (!year || !month || !day) return iso;
	return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function shortDate(iso: string): string {
	const [year, month, day] = iso.split('-').map(Number);
	if (!year || !month || !day) return iso;
	return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day)));
}
