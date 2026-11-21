import { slotAvailability } from '../scheduling/availability.ts';
import { db } from '../db.ts';
import { chicagoToday, materializeSeriesOccurrences, type CapacityUnit } from '../scheduling/schedule-series.ts';
import { formatTourWhen, type SlotType, type TourStatus } from './model.ts';
import { publishedTourSummary } from './website.ts';

export type FamilySlot = {
	id: string;
	seriesId: string;
	date: string;
	start: string;
	end: string;
	type: SlotType;
	capacity: number;
	capacityUnit: CapacityUnit;
	taken: number;
	spots: number;
	unavailable: boolean;
	mine: boolean;
};

export type FamilyHold = {
	id: string;
	kind: 'slot' | 'other';
	status: TourStatus;
	slotId: string;
	when: string;
	otherTime: string;
	grades: string[];
	note: string;
	phone: string;
	headCount: number;
	proposedWhen: string;
};

/**
 * A family's bookable times and their own bookings. Tours and interviews are the
 * same engine kept apart: `kind` picks which times and bookings to show.
 */
export async function familyTourView(familyId: string, today = chicagoToday(), kind: 'tour' | 'interview' = 'tour'): Promise<{ slots: FamilySlot[]; holds: FamilyHold[]; summary: Awaited<ReturnType<typeof publishedTourSummary>> }> {
	await materializeSeriesOccurrences();
	const [slots, holds] = await Promise.all([db()`
		select s.id, s.series_id, s.slot_date::text as slot_date, s.start_time, s.end_time, s.capacity, s.capacity_unit, s.slot_type, s.published,
			availability.taken as taken_by_others, availability.mine
		from tour_slots s left join schedule_series series on series.id = s.series_id
		cross join lateral (${slotAvailability(db(), familyId)}) availability
		where (series.booking_window_days is null or s.slot_date <= ${today}::date + series.booking_window_days)
		and (s.slot_type = 'interview') = ${kind === 'interview'}
		and ((s.slot_date >= ${today}::date and s.published) or exists (
			select 1 from tour_holds h
			where h.slot_id = s.id and h.family_id = ${familyId} and h.kind = 'slot' and h.status <> 'cancelled'
		))
		order by s.slot_date, s.start_time
	`, db()`
		select h.id, h.kind, h.status, h.slot_id, h.other_time, h.grades, h.note, h.phone, h.head_count,
			h.proposed_date::text as proposed_date, h.proposed_start, h.proposed_end,
			s.slot_date::text as slot_date, s.start_time, s.end_time
		from tour_holds h
		left join tour_slots s on s.id = h.slot_id
		where h.family_id = ${familyId} and h.status <> 'cancelled'
			and (coalesce(s.slot_type, 'tour') = 'interview') = ${kind === 'interview'}
		order by h.created_at desc
	`]);
	return {
		summary: await publishedTourSummary(),
		slots: slots.map((row) => ({
			id: String(row.id),
			seriesId: row.series_id ? String(row.series_id) : '',
			date: String(row.slot_date),
			start: String(row.start_time),
			end: String(row.end_time),
			type: row.slot_type === 'open_house' || row.slot_type === 'info_night' || row.slot_type === 'interview' ? row.slot_type : 'tour',
			capacity: Number(row.capacity),
			capacityUnit: row.capacity_unit === 'families' ? 'families' : 'people',
			taken: Number(row.taken_by_others),
			spots: Math.max(0, Number(row.capacity) - Number(row.taken_by_others)),
			unavailable: Number(row.taken_by_others) >= Number(row.capacity) && !row.mine,
			mine: Boolean(row.mine),
		})),
		holds: holds.map((row) => ({
			id: String(row.id),
			kind: row.kind === 'other' ? 'other' : 'slot',
			status: String(row.status) as TourStatus,
			slotId: row.slot_id ? String(row.slot_id) : '',
			when: row.slot_date ? formatTourWhen(String(row.slot_date), String(row.start_time), String(row.end_time)) : '',
			otherTime: String(row.other_time ?? ''),
			grades: Array.isArray(row.grades) ? row.grades.map(String) : [],
			note: String(row.note ?? ''),
			phone: String(row.phone ?? ''),
			headCount: Number(row.head_count ?? 1),
			proposedWhen: row.proposed_date ? formatTourWhen(String(row.proposed_date), String(row.proposed_start || '00:00'), String(row.proposed_end || row.proposed_start || '00:00')) : '',
		})),
	};
}
