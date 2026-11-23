import { db, dbReady } from './db.ts';

/** Students by status for this school year and next, for the admin overview. */
export async function enrollmentCounts(current: string, next: string): Promise<{ now: number; nextConfirmed: number; nextWaiting: number }> {
	await dbReady();
	const [row] = await db()`
		select
			count(*) filter (where school_year = ${current} and status = 'enrolled')::int as now,
			count(*) filter (where school_year = ${next} and status = 'enrolled')::int as next_confirmed,
			count(*) filter (where school_year = ${next} and status = 'pending')::int as next_waiting
		from enrollments`;
	return { now: Number(row?.now ?? 0), nextConfirmed: Number(row?.next_confirmed ?? 0), nextWaiting: Number(row?.next_waiting ?? 0) };
}

/** Open forms past their due date that some families still haven't submitted. */
export async function overdueForms(today: string): Promise<{ id: string; title: string; dueOn: string; missing: number }[]> {
	await dbReady();
	const rows = await db()`
		select f.id, f.title, f.due_on::text as due_on,
			(select count(*) from form_assignments a where a.form_id = f.id and a.status <> 'submitted')::int as missing
		from school_forms f
		where f.status = 'open' and f.due_on is not null and f.due_on < ${today}::date
		order by f.due_on`;
	return rows.map((row) => ({ id: String(row.id), title: String(row.title), dueOn: String(row.due_on), missing: Number(row.missing) })).filter((row) => row.missing > 0);
}
