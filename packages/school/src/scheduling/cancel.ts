import type { Sql } from '../db.ts';

export type CancelledHold = { family_id: string; family_name: string; email: string; slot_date: string; start_time: string; end_time: string };
type CancelledReservation = Omit<CancelledHold, 'slot_date' | 'start_time' | 'end_time'> & {
	id: string; kind: string; other_time: string; slot_id: string | null;
	slot_date: string | null; start_time: string | null; end_time: string | null;
};
type Cancellation = { slotIds: string[] } | { id: string; familyId?: string; kind?: 'other' };

/** No delivery policy here. Caller locks slots before bulk cancellation/deletion. */
export async function cancelHolds(sql: Sql, target: Cancellation): Promise<CancelledReservation[]> {
	if ('slotIds' in target && !target.slotIds.length) return [];
	const filter = 'slotIds' in target
		? sql`slot_id = any(${target.slotIds}::uuid[])`
		: sql`id = ${target.id} and (${target.familyId ?? null}::uuid is null or family_id = ${target.familyId ?? null}::uuid)
			and (${target.kind ?? null}::text is null or kind = ${target.kind ?? null})`;
	const rows = await sql`with cancelled as (
		update tour_holds set status = 'cancelled' where ${filter} and status <> 'cancelled'
		returning id, family_id, family_name, email, kind, other_time, slot_id
	) select h.*, s.slot_date::text, s.start_time, s.end_time
		from cancelled h left join tour_slots s on s.id = h.slot_id`;
	return rows as unknown as CancelledReservation[];
}
