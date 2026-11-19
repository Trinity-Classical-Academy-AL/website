
export const TOUR_STATUSES = { NEW: 'new', CONTACTED: 'contacted', CONFIRMED: 'confirmed', CANCELLED: 'cancelled', PROPOSED: 'proposed' } as const;
export const SLOT_TYPES = ['tour', 'open_house', 'info_night'] as const;

export type SlotType = (typeof SLOT_TYPES)[number];

export function slotTypeLabel(type: string): string {
	if (type === 'open_house') return 'Open house';
	if (type === 'info_night') return 'Info night';
	return 'Campus tour';
}

export type TourStatus = (typeof TOUR_STATUSES)[keyof typeof TOUR_STATUSES];

export function formatTourClock(value: string): string {
	const match = /^(\d{1,2}):(\d{2})/.exec(value);
	if (!match) return value;
	const hour = Number(match[1]);
	const suffix = hour >= 12 ? 'PM' : 'AM';
	const hour12 = hour % 12 || 12;
	return `${hour12}:${match[2]} ${suffix}`;
}

export function formatTourWhen(date: string, start: string, end: string): string {
	const [year, month, day] = date.split('-').map(Number);
	if (!year || !month || !day) return `${date} ${formatTourClock(start)}–${formatTourClock(end)}`;
	const label = new Intl.DateTimeFormat('en-US', {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC',
	}).format(new Date(Date.UTC(year, month - 1, day)));
	return `${label}, ${formatTourClock(start)}–${formatTourClock(end)}`;
}
