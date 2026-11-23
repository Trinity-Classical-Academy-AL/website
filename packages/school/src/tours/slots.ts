import type { Result } from '../result.ts';
import { randomUUID } from 'node:crypto';
import { db, dbReady } from '../db.ts';
import { fieldErrorMessage } from '../result.ts';
import { chicagoToday, listSeriesOccurrences, removeSlotOccurrences, skipSeriesDate, deleteSeries, type CapacityUnit } from '../scheduling/schedule-series.ts';
import { SLOT_TYPES, formatTourWhen, type SlotType } from './model.ts';
import { notifyCancelledTours } from './notifications.ts';

/** Kept for older callers. Tour times are only created by staff or rules. */
export async function ensureTourSlots(): Promise<void> {}

export type { CapacityUnit } from '../scheduling/schedule-series.ts';

export type TourSlotSummary = {
	seriesId: string;
	id: string;
	date: string;
	start: string;
	end: string;
	when: string;
	type: string;
	capacity: number;
	capacityUnit: CapacityUnit;
	taken: number;
	families: number;
	published: boolean;
};

export async function listTourSlotSummary({ publicOnly = false, today = chicagoToday() }: { publicOnly?: boolean; today?: string } = {}): Promise<TourSlotSummary[]> {
	const slots = await listSeriesOccurrences({ publicOnly, today });
	return slots.filter(slot => SLOT_TYPES.includes(slot.type as SlotType)).map(slot => ({
		...slot, when: formatTourWhen(slot.date, slot.start, slot.end),
	}));
}

export async function addTourSlot(input: { date: string; start: string; end: string; capacity: number; type?: string; published?: boolean; capacityUnit?: CapacityUnit }): Promise<Result<{ id: string }>> {
	await dbReady();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false, error: 'Choose a date.' };
	if (!/^\d{2}:\d{2}$/.test(input.start) || !/^\d{2}:\d{2}$/.test(input.end) || input.start >= input.end) {
		return { ok: false, error: 'Enter a start and end time.' };
	}
	const capacity = Number.isInteger(input.capacity) && input.capacity >= 1 && input.capacity <= 500 ? input.capacity : 0;
	if (!capacity) return { ok: false, error: 'Capacity must be at least 1.' };
	const slotType = input.type === 'open_house' || input.type === 'info_night' || input.type === 'interview' ? input.type : 'tour';
	const published = input.published !== false;
	const existing = await db()`
		select id from tour_slots
		where slot_date = ${input.date}::date and start_time = ${input.start} and end_time = ${input.end}
	`;
	if (existing[0]) return { ok: false, error: 'That slot already exists.' };
	const id = randomUUID();
	await db()`
		insert into tour_slots (id, slot_date, start_time, end_time, capacity, capacity_unit, slot_type, published)
		values (${id}, ${input.date}::date, ${input.start}, ${input.end}, ${capacity}, ${input.capacityUnit === 'families' ? 'families' : 'people'}, ${slotType}, ${published})
	`;
	return { ok: true, id };
}

export type SlotFields = { date?: string; end?: string; capacity?: string };

function slotType(value: string): SlotType {
	return value === 'open_house' || value === 'info_night' || value === 'interview' ? value : 'tour';
}

export async function updateTourSlot(input: {
	id: string;
	date: string;
	start: string;
	end: string;
	capacity: number;
	capacityUnit?: CapacityUnit;
	type?: string;
	published?: boolean;
}): Promise<Result<{}, { fields?: SlotFields }>> {
	await dbReady();
	const fields: SlotFields = {};
	if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) fields.date = 'Enter a date.';
	if (!/^\d{2}:\d{2}$/.test(input.start) || !/^\d{2}:\d{2}$/.test(input.end) || input.start >= input.end) fields.end = 'End must be after start.';
	const capacity = Number.isInteger(input.capacity) ? input.capacity : 0;
	if (capacity < 1 || capacity > 500) fields.capacity = 'Capacity must be at least 1.';
	if (Object.keys(fields).length) return { ok: false, error: fieldErrorMessage(fields), fields };
	const clash = await db()`
		select id from tour_slots
		where slot_date = ${input.date}::date and start_time = ${input.start} and end_time = ${input.end} and id <> ${input.id}
	`;
	if (clash[0]) return { ok: false, error: 'That time already exists.' };
	await db()`
		update tour_slots
		set slot_date = ${input.date}::date, start_time = ${input.start}, end_time = ${input.end},
			capacity = ${capacity}, capacity_unit = ${input.capacityUnit === 'families' ? 'families' : 'people'}, slot_type = ${slotType(input.type ?? 'tour')}, published = ${input.published !== false}
		where id = ${input.id}
	`;
	return { ok: true };
}

export async function deleteTourSlot(id: string): Promise<Result<{ notified: number }>> {
	await dbReady();
	const [slot] = await db()`select series_id, slot_date::text from tour_slots where id = ${id}`;
	if (!slot) return { ok: false, error: 'That time is already gone.' };
	if (slot.series_id) {
		const result = await skipTourSeriesDate(String(slot.series_id), String(slot.slot_date));
		return result.ok ? { ok: true, notified: result.notified ?? 0 } : { ok: false, error: result.error! };
	}
	const holds = await db().begin(async tx => {
		if (!(await tx`select id from tour_slots where id = ${id} for update`)[0]) return null;
		return removeSlotOccurrences(tx as unknown as ReturnType<typeof db>, [id]);
	});
	if (!holds) return { ok: false, error: 'That time is already gone.' };
	await notifyCancelledTours(holds);
	return { ok: true, notified: holds.length };
}

export async function skipTourSeriesDate(id: string, date: string, restore = false) {
	const result = await skipSeriesDate(id, date, restore);
	if (result.ok && result.cancelledHolds) await notifyCancelledTours(result.cancelledHolds);
	return { ...result, notified: result.ok ? result.cancelledHolds.length : 0 };
}
export async function deleteTourSeries(id: string) {
	const result = await deleteSeries(id);
	if (result.ok && result.cancelledHolds) await notifyCancelledTours(result.cancelledHolds);
	return result;
}
