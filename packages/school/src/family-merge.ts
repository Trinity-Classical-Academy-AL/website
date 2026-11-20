import { randomUUID } from 'node:crypto';
import { db, dbReady } from './db.ts';
import { notifyStaff, portalOrigin, sendEmail } from './email.ts';
import type { Result } from './result.ts';
import { ensurePeople } from './people.ts';

/**
 * Families join by request, never by lookup: whoever asks never learns whether an
 * email has an account. A request names the family that goes away (`from`) and the
 * family that stays (`to`). The side that did not start it approves; staff can
 * approve anything or merge directly.
 */

export type JoinRequest = {
	id: string;
	fromFamilyId: string;
	toFamilyId: string;
	initiatedBy: 'from' | 'to';
	targetEmail: string;
	status: 'pending' | 'approved' | 'declined' | 'cancelled';
	createdAt: string;
	fromName: string;
	fromEmail: string;
	toName: string;
	toEmail: string;
};

export type FamilyActivityItem = { id: string; at: string; by: string; kind: 'note' | 'merged' | 'joined' | 'request'; note: string };

const REQUEST_DAYS = 14;
const MAX_OPEN_PER_FAMILY = 5;
const validAddress = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const iso = (value: unknown) => new Date(value as string).toISOString();
// Rows with a family_id that move as a whole. Tables with a uniqueness rule on
// family_id are handled before this list (see mergeFamilies).
const MOVE_TABLES = [
	'email_tokens', 'tour_bookings', 'questions', 'time_requests', 'students', 'tour_holds', 'email_codes',
	'school_documents', 'classreach_families', 'classreach_students', 'classreach_guardians', 'family_activity', 'family_people', 'applications',
] as const;

/** The family that owns an email, following merges. */
async function familyForEmail(email: string): Promise<string | null> {
	const [row] = await db()`
		select coalesce(f.merged_into_id, f.id) as id from families f
		where f.id = coalesce(
			(select family_id from family_emails where email = ${email}),
			(select id from families where lower(email) = ${email} limit 1))
	`;
	return row ? String(row.id) : null;
}

async function familyEmails(familyId: string): Promise<string[]> {
	const rows = await db()`select email from family_emails where family_id = ${familyId} and verified_at is not null order by is_primary desc`;
	if (rows.length) return rows.map((row) => String(row.email));
	const [family] = await db()`select email from families where id = ${familyId}`;
	return family ? [String(family.email)] : [];
}

async function familyLabel(familyId: string): Promise<{ name: string; email: string }> {
	const [row] = await db()`select coalesce(nullif(household_name, ''), name) as name, email from families where id = ${familyId}`;
	return { name: String(row?.name || ''), email: String(row?.email || '') };
}

export async function logFamilyActivity(familyId: string, kind: FamilyActivityItem['kind'], by: string, note: string): Promise<void> {
	await dbReady();
	await db()`insert into family_activity (id, family_id, by, kind, note) values (${randomUUID()}, ${familyId}, ${by}, ${kind}, ${note.trim().slice(0, 4000)})`;
}

export async function addFamilyNote(familyId: string, by: string, note: string): Promise<Result> {
	if (!note.trim()) return { ok: false, error: 'Write a note first.' };
	await logFamilyActivity(familyId, 'note', by, note);
	return { ok: true };
}

export async function listFamilyActivity(familyId: string): Promise<FamilyActivityItem[]> {
	await dbReady();
	const rows = await db()`select * from family_activity where family_id = ${familyId} order by at desc, id`;
	return rows.map((row) => ({ id: String(row.id), at: iso(row.at), by: String(row.by), kind: row.kind, note: String(row.note) }));
}

/**
 * Ask to join the family that owns `email`. Always reports success with the same
 * message, whether or not that email has an account.
 */
export async function requestToJoin(fromFamilyId: string, emailInput: string): Promise<Result> {
	await dbReady();
	const email = emailInput.trim().toLowerCase();
	if (!validAddress(email)) return { ok: false, error: 'Enter an email address like name@example.com.' };
	const open = await db()`select count(*)::int as n from family_join_requests where from_family_id = ${fromFamilyId} and status = 'pending'`;
	if (open[0].n >= MAX_OPEN_PER_FAMILY) return { ok: false, error: 'You have several requests waiting. Cancel one or wait for an answer.' };
	const toFamilyId = await familyForEmail(email);
	if (!toFamilyId || toFamilyId === fromFamilyId) return { ok: true };
	const created = await createRequest(fromFamilyId, toFamilyId, 'from', email);
	if (created) {
		const from = await familyLabel(fromFamilyId);
		await notify(toFamilyId, `${from.name || from.email} asked to join your family on the TCA portal`,
			`${from.name || 'Someone'} (${from.email}) asked to join your family on the Trinity Classical Academy portal.\n\nIf this is someone in your household, sign in to approve. Their emails, children and tour requests will join your family, and you'll both see the same information.\n\nReview the request: ${portalOrigin()}/account#family\n\nIf you don't know them, decline it or ignore this email. It expires in ${REQUEST_DAYS} days.`);
	}
	return { ok: true };
}

/**
 * Invite the person who owns `email`, which belongs to another family, to join this
 * one. Used when someone adds an email that already has its own account.
 */
export async function inviteToFamily(toFamilyId: string, emailInput: string): Promise<Result> {
	await dbReady();
	const email = emailInput.trim().toLowerCase();
	const fromFamilyId = await familyForEmail(email);
	if (!fromFamilyId || fromFamilyId === toFamilyId) return { ok: false, error: 'That email is not on another account.' };
	const created = await createRequest(fromFamilyId, toFamilyId, 'to', email);
	if (created) {
		const to = await familyLabel(toFamilyId);
		await notify(fromFamilyId, `${to.name || to.email} invited you to join their family on the TCA portal`,
			`${to.name || 'Someone'} (${to.email}) invited you to join their family on the Trinity Classical Academy portal.\n\nIf you're in the same household, sign in to accept. Your emails, children and tour requests will move into their family, and you'll both see the same information. You keep signing in with your own email.\n\nReview the invitation: ${portalOrigin()}/account#family\n\nIt expires in ${REQUEST_DAYS} days.`);
	}
	return { ok: true };
}

async function createRequest(fromFamilyId: string, toFamilyId: string, initiatedBy: 'from' | 'to', email: string): Promise<boolean> {
	const rows = await db()`
		insert into family_join_requests (id, from_family_id, to_family_id, initiated_by, target_email)
		values (${randomUUID()}, ${fromFamilyId}, ${toFamilyId}, ${initiatedBy}, ${email})
		on conflict do nothing returning id
	`;
	if (rows[0]) await logFamilyActivity(initiatedBy === 'from' ? fromFamilyId : toFamilyId, 'request', '', initiatedBy === 'from' ? `Asked to join the family of ${email}` : `Invited ${email} to join the family`);
	return !!rows[0];
}

async function notify(familyId: string, subject: string, text: string) {
	for (const to of await familyEmails(familyId)) await sendEmail({ to, subject, text });
}

function mapRequest(row: Record<string, unknown>): JoinRequest {
	return {
		id: String(row.id), fromFamilyId: String(row.from_family_id), toFamilyId: String(row.to_family_id),
		initiatedBy: row.initiated_by as 'from' | 'to', targetEmail: String(row.target_email), status: row.status as JoinRequest['status'],
		createdAt: iso(row.created_at), fromName: String(row.from_name || ''), fromEmail: String(row.from_email || ''),
		toName: String(row.to_name || ''), toEmail: String(row.to_email || ''),
	};
}

/** Open requests that involve a family, newest first. Expired ones are left out. */
export async function listJoinRequests(familyId?: string): Promise<JoinRequest[]> {
	await dbReady();
	const rows = await db()`
		select r.*,
			coalesce(nullif(f.household_name, ''), f.name) as from_name, f.email as from_email,
			coalesce(nullif(t.household_name, ''), t.name) as to_name, t.email as to_email
		from family_join_requests r
		join families f on f.id = r.from_family_id join families t on t.id = r.to_family_id
		where r.status = 'pending' and r.created_at > now() - make_interval(days => ${REQUEST_DAYS})
			and (${familyId ?? null}::uuid is null or r.from_family_id = ${familyId ?? null}::uuid or r.to_family_id = ${familyId ?? null}::uuid)
		order by r.created_at desc
	`;
	return rows.map(mapRequest);
}

/** Which side may answer a request: the side that did not start it. */
export const answeringFamily = (request: Pick<JoinRequest, 'initiatedBy' | 'fromFamilyId' | 'toFamilyId'>) =>
	request.initiatedBy === 'from' ? request.toFamilyId : request.fromFamilyId;

export async function answerJoinRequest(input: { id: string; familyId: string | null; approve: boolean; by: string; staff?: boolean }): Promise<Result> {
	const [request] = (await listJoinRequests()).filter((item) => item.id === input.id);
	if (!request) return { ok: false, error: 'That request is no longer open.' };
	if (!input.staff && answeringFamily(request) !== input.familyId) return { ok: false, error: 'That request is no longer open.' };
	if (!input.approve) {
		await db()`update family_join_requests set status = 'declined', decided_at = now(), decided_by = ${input.by} where id = ${request.id}`;
		return { ok: true };
	}
	const merged = await mergeFamilies({ fromFamilyId: request.fromFamilyId, toFamilyId: request.toFamilyId, by: input.by, staff: input.staff });
	if (!merged.ok) return merged;
	await db()`update family_join_requests set status = 'approved', decided_at = now(), decided_by = ${input.by} where id = ${request.id}`;
	return { ok: true };
}

export async function cancelJoinRequest(id: string, familyId: string, by: string): Promise<Result> {
	await dbReady();
	await db()`
		update family_join_requests set status = 'cancelled', decided_at = now(), decided_by = ${by}
		where id = ${id} and status = 'pending'
			and ((initiated_by = 'from' and from_family_id = ${familyId}) or (initiated_by = 'to' and to_family_id = ${familyId}))
	`;
	return { ok: true };
}

/**
 * Move everything from one family into another in one transaction. The old row
 * stays, marked merged_into_id, so sessions and links that name it follow along.
 * Two enrolled families with students only merge when staff do it.
 */
export async function mergeFamilies(input: { fromFamilyId: string; toFamilyId: string; by: string; staff?: boolean }): Promise<Result> {
	await dbReady();
	const { fromFamilyId: from, toFamilyId: to } = input;
	if (from === to) return { ok: false, error: 'Those are the same family.' };
	const rows = await db()`select id, name, email, roles, merged_into_id, (select count(*)::int from students s where s.family_id = f.id) as students from families f where id in ${db()([from, to])}`;
	const source = rows.find((row) => String(row.id) === from), target = rows.find((row) => String(row.id) === to);
	if (!source || !target) return { ok: false, error: 'That family no longer exists.' };
	if (source.merged_into_id || target.merged_into_id) return { ok: false, error: 'One of these families was already merged.' };
	if (!input.staff && source.students > 0 && target.students > 0) {
		await notifyStaff('Two enrolled families asked to combine',
			`${source.name || source.email} (${source.email}) and ${target.name || target.email} (${target.email}) asked to combine their families, and both have students. Review both on the Families page and merge them from the family page if they belong together.\n\n${portalOrigin()}/admin/families/${to}`);
		return { ok: false, error: 'Both families have enrolled students, so the school office needs to combine them. We’ve let them know.' };
	}
	// Both sides need people first so each email keeps its person when it moves.
	await ensurePeople(from); await ensurePeople(to);
	await db().begin(async (tx) => {
		// Uniqueness on family_id: keep the staying family's row when both have one.
		await tx`delete from rsvps r where r.family_id = ${from} and exists (select 1 from rsvps o where o.family_id = ${to} and o.event_id = r.event_id)`;
		await tx`update rsvps set family_id = ${to} where family_id = ${from}`;
		await tx`delete from notification_routes where family_id = ${from}`;
		await tx`delete from form_assignments a where a.family_id = ${from} and exists (select 1 from form_assignments o where o.family_id = ${to} and o.form_id = a.form_id and o.student_id is not distinct from a.student_id)`;
		await tx`update form_assignments set family_id = ${to} where family_id = ${from}`;
		// Older accounts may only have families.email; make sure it travels too.
		await tx`
			insert into family_emails (id, family_id, email, is_primary, verified_at, password_hash, google_sub)
			select gen_random_uuid(), f.id, lower(f.email), false, f.email_verified_at, f.password_hash, f.google_sub from families f
			where f.id = ${from} and not exists (select 1 from family_emails e where e.email = lower(f.email))`;
		await tx`update family_emails set family_id = ${to}, is_primary = false where family_id = ${from}`;
		const offset = await tx`select coalesce(max(position) + 1, 0)::int as n from prospect_children where family_id = ${to}`;
		await tx`update prospect_children set family_id = ${to}, position = position + ${offset[0].n} where family_id = ${from}`;
		for (const table of MOVE_TABLES) await tx`update ${tx(table)} set family_id = ${to} where family_id = ${from}`;
		await tx`update family_join_requests set status = 'cancelled', decided_at = now(), decided_by = 'merged' where status = 'pending' and (from_family_id = ${from} or to_family_id = ${from})`;
		const roles = [...new Set([...(target.roles as string[]), ...(source.roles as string[])])];
		const merged = roles.includes('guardian') ? roles.filter((role) => role !== 'prospect') : roles;
		await tx`update families set roles = ${merged} where id = ${to}`;
		await tx`update families set merged_into_id = ${to} where id = ${from} or merged_into_id = ${from}`;
		await tx`insert into family_activity (id, family_id, by, kind, note) values (${randomUUID()}, ${to}, ${input.by}, 'merged', ${`${source.name || source.email} (${source.email}) joined this family`})`;
	});
	return { ok: true };
}

/**
 * Fold email-only contacts (inquiries, updates-list sign-ups) into a family by
 * adding their emails to it, unverified. Their inquiries then group under it.
 */
export async function attachEmailsToFamily(familyId: string, emails: string[], by: string): Promise<Result> {
	await dbReady();
	const clean = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(validAddress))];
	for (const email of clean) {
		await db()`insert into family_emails (id, family_id, email, is_primary) values (${randomUUID()}, ${familyId}, ${email}, false) on conflict (email) do nothing`;
	}
	if (clean.length) await logFamilyActivity(familyId, 'merged', by, `Added ${clean.join(', ')} to this family`);
	return { ok: true };
}

/** Every child entry on a family: enrolled students and children added as a prospect. */
export type ChildEntry = { id: string; kind: 'student' | 'child'; familyId: string; name: string; detail: string };

export async function listChildEntries(familyIds: string[]): Promise<ChildEntry[]> {
	await dbReady();
	if (!familyIds.length) return [];
	const [students, children] = await Promise.all([
		db()`select id, family_id, name, grade, teacher from students where family_id in ${db()(familyIds)} order by name`,
		db()`select id, family_id, first_name, grade, school_year from prospect_children where family_id in ${db()(familyIds)} order by position, first_name`,
	]);
	return [
		...students.map((row) => ({ id: String(row.id), kind: 'student' as const, familyId: String(row.family_id), name: String(row.name),
			detail: [row.grade && `Grade ${row.grade}`, row.teacher].filter(Boolean).join(' · ') })),
		...children.map((row) => ({ id: String(row.id), kind: 'child' as const, familyId: String(row.family_id), name: String(row.first_name),
			detail: [row.grade, row.school_year].filter(Boolean).join(' · ') })),
	];
}

/**
 * Fold duplicate child entries into one, after a merge put them in one family.
 * `keep` survives; `drop` is removed. A dropped student's form assignments move
 * to the kept student; a kept prospect child fills blanks from the dropped one.
 */
export async function combineChildEntries(familyId: string, pairs: { keep: string; drop: string }[], by: string): Promise<Result> {
	await dbReady();
	if (!pairs.length) return { ok: true };
	const entries = await listChildEntries([familyId]);
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	const names: string[] = [];
	await db().begin(async (tx) => {
		for (const { keep: keepId, drop: dropId } of pairs) {
			const keep = byId.get(keepId), drop = byId.get(dropId);
			if (!keep || !drop || keep.id === drop.id) continue;
			if (drop.kind === 'student') {
				if (keep.kind !== 'student') continue; // never drop a student in favor of a prospect entry
				await tx`delete from form_assignments a where a.student_id = ${drop.id} and exists (select 1 from form_assignments o where o.student_id = ${keep.id} and o.form_id = a.form_id)`;
				await tx`update form_assignments set student_id = ${keep.id} where student_id = ${drop.id}`;
				await tx`delete from students where id = ${drop.id} and family_id = ${familyId}`;
			} else {
				if (keep.kind === 'child') {
					await tx`
						update prospect_children k set grade = coalesce(nullif(k.grade, ''), d.grade), school_year = coalesce(nullif(k.school_year, ''), d.school_year)
						from prospect_children d where k.id = ${keep.id} and d.id = ${drop.id}`;
				}
				await tx`delete from prospect_children where id = ${drop.id} and family_id = ${familyId}`;
			}
			byId.delete(drop.id);
			names.push(keep.name === drop.name ? keep.name : `${drop.name} into ${keep.name}`);
		}
	});
	if (names.length) await logFamilyActivity(familyId, 'merged', by, `Combined duplicate child entries: ${names.join(', ')}`);
	return { ok: true };
}
