import type { Sql } from '../db.ts';

/** Correlated lateral query for slot alias `s`. Active slot holds consume units;
 * family views and reservations exclude the caller's own holds, admin/public do not.
 * Keep this in SQL so every list remains one bounded query, including distinct families.
 */
export function slotAvailability(sql: Sql, excludeFamilyId: string | null = null) {
	return sql`select
		(case when s.capacity_unit = 'families' then
			count(distinct h.family_id) filter (where ${excludeFamilyId}::uuid is null or h.family_id <> ${excludeFamilyId}::uuid)
		else coalesce(sum(h.head_count) filter (where ${excludeFamilyId}::uuid is null or h.family_id <> ${excludeFamilyId}::uuid), 0) end)::int as taken,
		count(distinct h.family_id) filter (where ${excludeFamilyId}::uuid is null or h.family_id <> ${excludeFamilyId}::uuid)::int as families,
		coalesce(bool_or(h.family_id = ${excludeFamilyId}::uuid), false) as mine
		from tour_holds h where h.slot_id = s.id and h.kind = 'slot' and h.status <> 'cancelled'`;
}
