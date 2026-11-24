
export const TOUR_STATUSES = { NEW: 'new', CONTACTED: 'contacted', CONFIRMED: 'confirmed', CANCELLED: 'cancelled', PROPOSED: 'proposed' } as const;
// private_tour: a time the school set up for one family's request. Never published or bookable by others.
export const SLOT_TYPES = ['tour', 'open_house', 'info_night', 'interview', 'private_tour'] as const;

export type SlotType = (typeof SLOT_TYPES)[number];

export function slotTypeLabel(type: string): string {
	if (type === 'open_house') return 'Open house';
	if (type === 'info_night') return 'Info night';
	if (type === 'interview') return 'Interview';
	if (type === 'private_tour') return 'Requested tour';
	return 'Campus tour';
}

export type TourStatus = (typeof TOUR_STATUSES)[keyof typeof TOUR_STATUSES];

export { formatTourClock, formatTourWhen } from '../time.ts';
