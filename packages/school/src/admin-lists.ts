import { db, dbReady } from './db.ts';
import { formatTourWhen } from './tours/model.ts';

/** Read list data in a fixed number of queries, independent of family count. */
export async function listEnrolledFamilies() {
	await dbReady();
	const rows = await db()`
		select f.id, f.name, f.email, f.created_at,
			coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'grade', s.grade) order by s.name)
				from (select id, family_id, name, grade, teacher from children where kind = 'student') s where s.family_id = f.id), '[]'::jsonb) as students
		from families f where 'guardian' = any(f.roles) and f.merged_into_id is null
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
				order by c.position, c.first_name) from (select id, family_id, name as first_name, grade, school_year, position from children where kind = 'prospective') c where c.family_id = f.id), '[]'::jsonb) as children,
			b.slot_date::text as slot_date, b.start_time, b.end_time, b.id as booking_id,
			exists (select 1 from tour_holds h where h.family_id = f.id and h.kind = 'other' and h.status <> 'cancelled') as requested,
			exists (select 1 from enrollments e join children c on c.id = e.child_id where c.family_id = f.id and e.status = 'enrolled'
				and e.school_year >= school_year_of((now() at time zone 'America/Chicago')::date)) as enrolled
		from families f
		left join lateral (
			select h.id, s.slot_date, s.start_time, s.end_time
			from tour_holds h left join tour_slots s on s.id = h.slot_id
			where h.family_id = f.id and h.kind = 'slot' and h.status <> 'cancelled'
			order by h.created_at desc limit 1
		) b on true
		where ('prospect' = any(f.roles) or not (f.roles && array['prospect', 'guardian', 'admin']::text[]))
			and not ('guardian' = any(f.roles)) and f.merged_into_id is null
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

/**
 * Every portal account with all of its emails, children and tour state, for the
 * combined Families directory. Staff-only accounts (admin without prospect or
 * guardian) are left out.
 */
export async function listFamilyAccounts() {
	await dbReady();
	const rows = await db()`
		select f.id, f.name, f.household_name, f.email, f.phone, f.roles, f.created_at, f.last_sign_in_at,
			coalesce((select array_agg(e.email order by e.is_primary desc, e.created_at) from family_emails e where e.family_id = f.id), '{}') as emails,
			coalesce((select array_agg(c.first_name order by c.position, c.first_name) from (select id, family_id, name as first_name, grade, school_year, position from children where kind = 'prospective') c where c.family_id = f.id), '{}') as children,
			coalesce((select array_agg(s.name order by s.name) from (select id, family_id, name, grade, teacher from children where kind = 'student') s where s.family_id = f.id), '{}') as students,
			b.slot_date::text as slot_date, b.start_time, b.end_time, b.id as booking_id,
			exists (select 1 from tour_holds h where h.family_id = f.id and h.kind = 'other' and h.status <> 'cancelled') as requested
		from families f
		left join lateral (
			select h.id, s.slot_date, s.start_time, s.end_time
			from tour_holds h left join tour_slots s on s.id = h.slot_id
			where h.family_id = f.id and h.kind = 'slot' and h.status <> 'cancelled'
			order by h.created_at desc limit 1
		) b on true
		where f.merged_into_id is null and ('prospect' = any(f.roles) or 'guardian' = any(f.roles) or not (f.roles && array['admin', 'staff']::text[]))
		order by f.created_at desc
	`;
	return rows.map((row) => {
		const emails = [...new Set([String(row.email), ...(row.emails as string[])].map((email) => email.toLowerCase()))];
		return {
			id: String(row.id), name: String(row.name), householdName: String(row.household_name || ''), email: String(row.email), emails,
			phone: String(row.phone || ''), roles: row.roles as string[],
			createdAt: new Date(row.created_at).toISOString(),
			lastSignInAt: row.last_sign_in_at ? new Date(row.last_sign_in_at).toISOString() : null,
			children: [...(row.students as string[]), ...(row.children as string[])].filter((name, index, all) => name && all.indexOf(name) === index),
			tour: row.booking_id ? (row.slot_date ? `Booked ${formatTourWhen(String(row.slot_date), String(row.start_time), String(row.end_time))}` : 'Booked') : row.requested ? 'Time requested' : '',
			tourDate: row.slot_date ? String(row.slot_date) : null,
			/** Has a child enrolled for this school year or later. */
			enrolled: Boolean(row.enrolled),
		};
	});
}
export type FamilyAccount = Awaited<ReturnType<typeof listFamilyAccounts>>[number];
