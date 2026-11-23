import { randomUUID } from 'node:crypto';
import type { Sql } from '../db.ts';
import type { Result } from '../result.ts';
import { slotAvailability } from './availability.ts';
import { bookingWindowEnd } from './window.ts';

export type ReservationParty = {
	familyId: string; name: string; email: string; phone: string;
	headCount: number; grades: string[]; note: string;
};
type ReservationSource =
	| { kind: 'booking' }
	| { kind: 'confirmation'; holdId: string; message?: string };
type Reserved = { changed: boolean; slot: { date: string; start: string; end: string; type: string } };

/** Caller owns the transaction. Consumers retain cleaning and notification policy.
 * Public bookings enforce visibility/window rules; staff confirmations and accepted
 * proposals keep their existing ability to confirm past or unpublished times.
 */
export async function reserve(tx: Sql, input: {
	slotId: string; party: ReservationParty; today: string; source: ReservationSource;
}): Promise<Result<Reserved>> {
	const { slotId, party, source } = input;
	await tx`select pg_advisory_xact_lock(hashtext(${slotId}))`;
	const [slot] = await tx`select s.slot_date::text, s.start_time, s.end_time, s.slot_type,
		s.capacity, s.capacity_unit, s.published, series.booking_window_days, availability.taken
		from tour_slots s left join schedule_series series on series.id = s.series_id
		cross join lateral (${slotAvailability(tx, party.familyId)}) availability
		where s.id = ${slotId} for update of s`;
	if (source.kind === 'booking') {
		if (!slot || slot.published === false || String(slot.slot_date) < input.today) return { ok: false, error: 'Choose a time to continue.' };
		const windowEnd = bookingWindowEnd(input.today, slot.booking_window_days == null ? null : Number(slot.booking_window_days));
		if (windowEnd && String(slot.slot_date) > windowEnd) return { ok: false, error: 'That time is no longer open.' };
		// Interview times are only for families the school has invited to interview.
		if (slot.slot_type === 'interview') {
			const [invited] = await tx`select 1 from applications where family_id = ${party.familyId} and status = 'interview'`;
			if (!invited) return { ok: false, error: 'Interview times open once the school invites you to interview.' };
		}
	}
	if (!slot || Number(slot.taken) + (slot.capacity_unit === 'families' ? 1 : party.headCount) > Number(slot.capacity)) return { ok: false, error: 'That time is full.' };
	let changed = true;
	if (source.kind === 'confirmation') {
		const rows = await tx`update tour_holds set kind = 'slot', slot_id = ${slotId}, status = 'confirmed', reply_message = coalesce(${source.message ?? null}, reply_message)
			where id = ${source.holdId} and family_id = ${party.familyId} and kind = 'other' and status <> 'cancelled' returning id`;
		if (!rows.length) return { ok: false, error: 'That request is no longer open.' };
	} else {
		// A family holds one tour time and, separately, one interview time.
		const interview = slot.slot_type === 'interview';
		const [current] = await tx`select h.id, h.slot_id from tour_holds h left join tour_slots t on t.id = h.slot_id
			where h.family_id = ${party.familyId} and h.kind = 'slot' and h.status <> 'cancelled'
				and (coalesce(t.slot_type, 'tour') = 'interview') = ${interview}
			order by h.created_at desc limit 1`;
		changed = !current || String(current.slot_id) !== slotId;
		if (current) {
			await tx`update tour_holds
				set slot_id = ${slotId}, family_name = ${party.name}, email = ${party.email}, phone = ${party.phone},
					grades = ${party.grades}, note = ${party.note}, head_count = ${party.headCount},
					status = case when slot_id is distinct from ${slotId} then 'new' else status end
				where id = ${current.id}`;
		} else {
			await tx`insert into tour_holds (id, family_id, slot_id, kind, status, family_name, email, phone, grades, note, head_count)
				values (${randomUUID()}, ${party.familyId}, ${slotId}, 'slot', 'new', ${party.name}, ${party.email}, ${party.phone}, ${party.grades}, ${party.note}, ${party.headCount})`;
		}
	}
	return { ok: true, changed, slot: { date: String(slot.slot_date), start: String(slot.start_time), end: String(slot.end_time), type: String(slot.slot_type || 'tour') } };
}
