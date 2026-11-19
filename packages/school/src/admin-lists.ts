import { db, dbReady } from './db.ts';
import { formatTourWhen } from './tours/model.ts';

/** Read list data in a fixed number of queries, independent of family count. */
export async function listEnrolledFamilies() {
	await dbReady();
	const rows = await db()`
		select f.id, f.name, f.email, f.created_at,
			coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'grade', s.grade) order by s.name)
				from students s where s.family_id = f.id), '[]'::jsonb) as students
		from families f where 'guardian' = any(f.roles)
		order by f.created_at desc
	`;
	return rows.map((row) => ({
		id: String(row.id), name: String(row.name), email: String(row.email),
		createdAt: new Date(row.created_at).toISOString(),
		students: row.students as Array<{ name: string; grade: string }>,
	}));
}

export async function listProspectAccounts() {
	await dbReady();
	const rows = await db()`
		select f.id, f.name, f.email, f.created_at,
			coalesce((select jsonb_agg(jsonb_build_object('firstName', c.first_name, 'schoolYear', c.school_year)
				order by c.position, c.first_name) from prospect_children c where c.family_id = f.id), '[]'::jsonb) as children,
			b.slot_date::text as slot_date, b.start_time, b.end_time, b.id as booking_id,
			exists (select 1 from tour_holds h where h.family_id = f.id and h.kind = 'other' and h.status <> 'cancelled') as requested
		from families f
		left join lateral (
			select h.id, s.slot_date, s.start_time, s.end_time
			from tour_holds h left join tour_slots s on s.id = h.slot_id
			where h.family_id = f.id and h.kind = 'slot' and h.status <> 'cancelled'
			order by h.created_at desc limit 1
		) b on true
		where ('prospect' = any(f.roles) or not (f.roles && array['prospect', 'guardian', 'admin']::text[]))
			and not ('guardian' = any(f.roles))
		order by f.created_at desc
	`;
	return rows.map((row) => ({
		id: String(row.id), name: String(row.name), email: String(row.email),
		createdAt: new Date(row.created_at).toISOString(),
		children: row.children as Array<{ firstName: string; schoolYear: string }>,
		// A deleted slot leaves an active hold with an empty formatted time, as before.
		tour: row.booking_id ? `Booked ${row.slot_date ? formatTourWhen(String(row.slot_date), String(row.start_time), String(row.end_time)) : ''}` : row.requested ? 'Time requested' : 'None',
	}));
}
