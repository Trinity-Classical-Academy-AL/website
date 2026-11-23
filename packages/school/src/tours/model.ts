
export const TOUR_STATUSES = { NEW: 'new', CONTACTED: 'contacted', CONFIRMED: 'confirmed', CANCELLED: 'cancelled', PROPOSED: 'proposed' } as const;
export const SLOT_TYPES = ['tour', 'open_house', 'info_night', 'interview'] as const;

export type SlotType = (typeof SLOT_TYPES)[number];

export function slotTypeLabel(type: string): string {
	if (type === 'open_house') return 'Open house';
	if (type === 'info_night') return 'Info night';
	if (type === 'interview') return 'Interview';
	return 'Campus tour';
}

export type TourStatus = (typeof TOUR_STATUSES)[keyof typeof TOUR_STATUSES];

export { formatTourClock, formatTourWhen } from '../time.ts';
