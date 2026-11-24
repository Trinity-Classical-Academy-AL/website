import { randomUUID } from 'node:crypto';
import { NOTIFICATION_CATEGORIES } from './accounts.ts';
import { schoolYearOf } from './applications.ts';
import { db, dbReady } from './db.ts';
import type { Result } from './result.ts';

/**
 * ClassReach directory match (migration step 1). The NucBox pull stages the
 * ClassReach directory in classreach_guardians / classreach_families /
 * classreach_students; this pairs each entry with a portal family and, only for
 * the entries an admin approves, mirrors it into the portal:
 *
 * - A guardian is keyed by email. Same email as a portal account → matched
 *   (import just records the link). Unknown email → new (import starts a family,
 *   or adds them to a family the admin picks). No email, an email on two
 *   families, or a last name shared with a portal family → conflict: the admin
 *   decides (pick a family, start a new one, or skip).
 * - A student finds its family by email (theirs or a parent's in the payload),
 *   then by a portal child with the same name, then by last name. One family →
 *   matched (a same-named child gets the ClassReach id) or new (a child is
 *   added). More than one, or none → conflict.
 *
 * Imported children carry children.classreach_id, and staged rows are marked
 * approved with their family, so running it again finds them as imported.
 * Nothing here sends email, and ClassReach is never written to.
 */

export type ClassReachMatchStatus = 'matched' | 'new' | 'conflict' | 'imported' | 'skipped';
export type ClassReachMatchAction = 'link' | 'create_family' | 'add_guardian' | 'add_child' | 'link_child' | 'none';
export type ClassReachMatchItem = {
	/** g:<id> guardian, f:<id> family-only directory entry, s:<id> student. */
	key: string;
	kind: 'guardian' | 'student';
	classreachId: string;
	name: string;
	email: string;
	grade: string;
	directory: string;
	status: ClassReachMatchStatus;
	action: ClassReachMatchAction;
	/** The portal family it matched, or the one import would use. */
	familyId: string | null;
	familyName: string;
	/** A student matched to an existing portal child. */
	childId: string | null;
	/** What the match rests on: Email, Name, Last name. */
	basis: string;
	reason: string;
	/** Families the admin can choose between for a conflict. */
	candidates: { id: string; name: string }[];
};
export type ClassReachMatchSummary = Record<ClassReachMatchStatus, number>;
export type ClassReachMatch = { items: ClassReachMatchItem[]; summary: ClassReachMatchSummary; families: { id: string; name: string }[] };

type Staged = { classreachId: string; email: string; fullName: string; directory: string; familyId: string | null; approval: string; payload: unknown };
export type ClassReachPlanInput = {
	guardians: Staged[];
	families: Staged[];
	students: Staged[];
	/** Keys (g:/f:/s:<id>) an admin set aside. */
	skips: Set<string>;
	/** Sign-in emails (lowercase) → families; child sign-ins are flagged. */
	emails: { email: string; familyId: string; child: boolean }[];
	portalFamilies: { id: string; name: string; lastName: string }[];
	children: { id: string; familyId: string; name: string; classreachId: string | null }[];
};

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);
/** ClassReach writes "Last, First" in places; the portal writes "First Last". */
export function classReachDisplayName(full: string): string {
	const clean = full.trim().replace(/\s+/g, ' ');
	const comma = clean.indexOf(',');
	if (comma < 0) return clean;
	const last = clean.slice(0, comma).trim(), first = clean.slice(comma + 1).trim();
	return SUFFIXES.has(first.toLowerCase().replace(/\./g, '')) ? clean : [first, last].filter(Boolean).join(' ');
}
const nameKey = (full: string) => classReachDisplayName(full).toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, '').replace(/\s+/g, ' ').trim();
function surname(full: string): string {
	const words = nameKey(full).split(' ').filter((word) => word && !SUFFIXES.has(word));
	return words.length > 1 ? words[words.length - 1] : '';
}
const firstName = (full: string) => classReachDisplayName(full).split(' ')[0] || full;

/** "Kindergarten", "K", "3rd Grade", "Grade 3" → K / 3. */
export function classReachGrade(level: string): string {
	const text = level.trim();
	if (!text) return '';
	if (/^k$|kinder/i.test(text)) return 'K';
	const number = text.match(/\d{1,2}/);
	return number ? String(Number(number[0])) : '';
}

const EMAIL = /[^\s@<>,;"']+@[^\s@<>,;"']+\.[a-z]{2,}/gi;
/** Parent emails a student's directory entry carries, wherever ClassReach puts them. */
function payloadEmails(payload: unknown, parentKey = false, depth = 0): string[] {
	if (depth > 4 || payload == null) return [];
	if (typeof payload === 'string') return parentKey ? (payload.match(EMAIL) ?? []).map((email) => email.toLowerCase()) : [];
	if (Array.isArray(payload)) return payload.flatMap((item) => payloadEmails(item, parentKey, depth + 1));
	if (typeof payload !== 'object') return [];
	return Object.entries(payload as Record<string, unknown>).flatMap(([key, value]) =>
		payloadEmails(value, parentKey || /parent|guardian|family|household|mother|father|contact/i.test(key), depth + 1));
}
const levelOf = (payload: unknown) => payload && typeof payload === 'object' ? String((payload as Record<string, unknown>).StudentAcademicLevel ?? '') : '';

export function planClassReachMatch(input: ClassReachPlanInput): ClassReachMatch {
	const familyName = new Map(input.portalFamilies.map((family) => [family.id, family.name]));
	const byEmail = new Map<string, Set<string>>();
	const childEmails = new Set<string>();
	for (const row of input.emails) {
		if (!familyName.has(row.familyId)) continue;
		if (row.child) childEmails.add(row.email);
		byEmail.set(row.email, (byEmail.get(row.email) ?? new Set()).add(row.familyId));
	}
	const bySurname = new Map<string, Set<string>>();
	const addSurname = (last: string, familyId: string) => { if (last) bySurname.set(last, (bySurname.get(last) ?? new Set()).add(familyId)); };
	for (const family of input.portalFamilies) {
		addSurname(family.lastName.trim().toLowerCase(), family.id);
		addSurname(surname(family.name), family.id);
	}
	const candidatesOf = (ids: Iterable<string>) => [...new Set(ids)].map((id) => ({ id, name: familyName.get(id) || 'Family' })).sort((a, b) => a.name.localeCompare(b.name));
	const items: ClassReachMatchItem[] = [];
	const base = (key: string, kind: ClassReachMatchItem['kind'], row: Staged): ClassReachMatchItem => ({
		key, kind, classreachId: row.classreachId, name: classReachDisplayName(row.fullName) || row.email || 'Unnamed', email: row.email.trim().toLowerCase(),
		grade: kind === 'student' ? classReachGrade(levelOf(row.payload)) : '', directory: row.directory,
		status: 'conflict', action: 'none', familyId: null, familyName: '', childId: null, basis: '', reason: '', candidates: [],
	});
	const set = (item: ClassReachMatchItem, patch: Partial<ClassReachMatchItem>) => {
		Object.assign(item, patch);
		if (item.familyId && !item.familyName) item.familyName = familyName.get(item.familyId) || '';
		return item;
	};

	// Guardians (and family-only entries with an email no guardian has).
	const guardianEmails = new Set(input.guardians.map((row) => row.email.trim().toLowerCase()).filter(Boolean));
	const guardianRows = [
		...input.guardians.map((row) => ({ key: `g:${row.classreachId}`, row })),
		...input.families.filter((row) => !guardianEmails.has(row.email.trim().toLowerCase())).map((row) => ({ key: `f:${row.classreachId}`, row })),
	];
	const unresolvedSurnames = new Map<string, string>();
	for (const { key, row } of guardianRows) {
		const item = base(key, 'guardian', row);
		items.push(item);
		const email = item.email;
		const ids = email ? [...(byEmail.get(email) ?? [])] : [];
		if (input.skips.has(key)) { set(item, { status: 'skipped', familyId: ids.length === 1 ? ids[0] : null, reason: 'Set aside. Nothing is imported for it.' }); continue; }
		if (!email) { set(item, { reason: 'No email in ClassReach, so it can’t be paired. Skip it, or add them by hand on the family page.' }); continue; }
		if (childEmails.has(email)) { set(item, { reason: 'This email is a student’s own sign-in in the portal.', candidates: candidatesOf(ids) }); continue; }
		if (ids.length > 1) { set(item, { basis: 'Email', reason: 'This email is on more than one portal family. Merge them first.', candidates: candidatesOf(ids) }); continue; }
		if (ids.length === 1) {
			addSurname(surname(row.fullName), ids[0]);
			if (row.approval === 'approved' && row.familyId === ids[0]) set(item, { status: 'imported', familyId: ids[0], basis: 'Email', reason: 'Linked to this portal family.' });
			else set(item, { status: 'matched', action: 'link', familyId: ids[0], basis: 'Email', reason: 'Same email as a portal account. Importing records the link; nothing else changes.' });
			continue;
		}
		if (surname(row.fullName) && !unresolvedSurnames.has(surname(row.fullName))) unresolvedSurnames.set(surname(row.fullName), item.name);
	}
	// New guardians: a portal family with the same last name may be their spouse's.
	const rowByKey = new Map(guardianRows.map((entry) => [entry.key, entry.row]));
	for (const item of items) {
		if (item.kind !== 'guardian' || item.status !== 'conflict' || item.reason) continue;
		const row = rowByKey.get(item.key)!;
		const same = [...(bySurname.get(surname(row.fullName)) ?? [])];
		if (same.length) {
			const candidates = candidatesOf(same);
			set(item, { basis: 'Last name', candidates, familyId: candidates.length === 1 ? candidates[0].id : null,
				reason: `Not in the portal yet, but ${candidates.length === 1 ? `the ${candidates[0].name} family has` : `${candidates.length} families have`} the same last name. Add them to a family, or start a new one.` });
		} else set(item, { status: 'new', action: 'create_family', reason: 'Not in the portal yet. Importing starts a family for them. No email goes out.' });
	}

	// Students.
	const childByClassReach = new Map(input.children.filter((child) => child.classreachId).map((child) => [child.classreachId!, child]));
	const unlinked = input.children.filter((child) => !child.classreachId && familyName.has(child.familyId));
	const claimed = new Set<string>();
	for (const row of input.students) {
		const key = `s:${row.classreachId}`;
		const item = base(key, 'student', row);
		items.push(item);
		const linked = childByClassReach.get(row.classreachId);
		if (linked) { set(item, { status: 'imported', familyId: linked.familyId, childId: linked.id, reason: 'Already in the portal.' }); continue; }
		const ids = new Set<string>();
		let basis = '';
		for (const email of [item.email, ...payloadEmails(row.payload)].filter(Boolean)) for (const id of byEmail.get(email) ?? []) ids.add(id);
		if (ids.size) basis = 'Email';
		const named = unlinked.filter((child) => nameKey(child.name) === nameKey(row.fullName));
		if (!ids.size) { for (const child of named) ids.add(child.familyId); if (ids.size) basis = 'Name'; }
		if (!ids.size) { for (const id of bySurname.get(surname(row.fullName)) ?? []) ids.add(id); if (ids.size) basis = 'Last name'; }
		if (input.skips.has(key)) { set(item, { status: 'skipped', familyId: ids.size === 1 ? [...ids][0] : null, reason: 'Set aside. Nothing is imported for it.' }); continue; }
		if (ids.size > 1) { set(item, { basis, candidates: candidatesOf(ids), reason: `More than one portal family could be ${firstName(row.fullName)}’s. Pick one.` }); continue; }
		if (!ids.size) {
			const waiting = unresolvedSurnames.get(surname(row.fullName));
			set(item, { reason: waiting ? `No portal family yet. Import ${waiting} first, or pick a family.` : 'No portal family found. Pick one.' });
			continue;
		}
		const familyId = [...ids][0];
		const child = named.find((entry) => entry.familyId === familyId && !claimed.has(entry.id));
		if (child) {
			claimed.add(child.id);
			set(item, { status: 'matched', action: 'link_child', familyId, childId: child.id, basis, reason: `Same name as a child on this family. Importing marks ${firstName(row.fullName)} as a current student.` });
		} else set(item, { status: 'new', action: 'add_child', familyId, basis, reason: `Importing adds ${firstName(row.fullName)} to this family as a current student.` });
	}

	const summary: ClassReachMatchSummary = { matched: 0, new: 0, conflict: 0, imported: 0, skipped: 0 };
	for (const item of items) summary[item.status] += 1;
	items.sort((a, b) => a.name.localeCompare(b.name));
	return { items, summary, families: candidatesOf(input.portalFamilies.map((family) => family.id)) };
}

/** The dry run: what an import would do. Reads only. */
export async function classReachMatch(): Promise<ClassReachMatch> {
	await dbReady();
	const sql = db();
	const staged = (rows: Record<string, unknown>[]): Staged[] => rows.map((row) => ({
		classreachId: String(row.classreach_id), email: String(row.email ?? ''), fullName: String(row.full_name ?? ''), directory: String(row.directory_name ?? ''),
		familyId: row.family_id ? String(row.family_id) : null, approval: String(row.approval ?? 'pending'), payload: row.payload,
	}));
	const guardians = await sql`select * from classreach_guardians`;
	const families = await sql`select * from classreach_families`;
	const students = await sql`select * from classreach_students`;
	const skips = await sql`select kind, classreach_id from classreach_match_skips`;
	const emails = await sql`
		select lower(e.email) as email, coalesce(f.merged_into_id, f.id) as family_id, e.child_id is not null as child
		from family_emails e join families f on f.id = e.family_id
		union all
		select lower(f.email), f.id, false from families f
		where f.merged_into_id is null and f.email <> '' and not exists (select 1 from family_emails e where e.email = lower(f.email))`;
	const portalFamilies = await sql`select id, coalesce(nullif(household_name, ''), nullif(name, ''), email) as name, last_name, name as holder from families where merged_into_id is null`;
	const children = await sql`select c.id, coalesce(f.merged_into_id, f.id) as family_id, c.name, c.classreach_id from children c join families f on f.id = c.family_id`;
	const prefix: Record<string, string> = { guardian: 'g', family: 'f', student: 's' };
	return planClassReachMatch({
		guardians: staged(guardians), families: staged(families), students: staged(students),
		skips: new Set(skips.map((row) => `${prefix[String(row.kind)]}:${row.classreach_id}`)),
		emails: emails.map((row) => ({ email: String(row.email), familyId: String(row.family_id), child: !!row.child })),
		// The holder's name carries the last name when the household has its own name.
		portalFamilies: portalFamilies.map((row) => ({ id: String(row.id), name: String(row.name), lastName: String(row.last_name || '') || surname(String(row.holder || '')) })),
		children: children.map((row) => ({ id: String(row.id), familyId: String(row.family_id), name: String(row.name), classreachId: row.classreach_id ? String(row.classreach_id) : null })),
	});
}

const SKIP_KIND: Record<string, 'guardian' | 'family' | 'student'> = { g: 'guardian', f: 'family', s: 'student' };
const splitKey = (key: string) => { const at = key.indexOf(':'); return { kind: SKIP_KIND[key.slice(0, at)], id: key.slice(at + 1) }; };

/** Set entries aside (or bring them back). Nothing is imported for a skipped entry. */
export async function skipClassReach(input: { keys: string[]; skip: boolean; by: string }): Promise<Result<{ count: number }>> {
	await dbReady();
	const keys = [...new Set(input.keys)].map(splitKey).filter((key) => key.kind && key.id);
	for (const key of keys) {
		if (input.skip) await db()`insert into classreach_match_skips (kind, classreach_id, by) values (${key.kind}, ${key.id}, ${input.by}) on conflict do nothing`;
		else await db()`delete from classreach_match_skips where kind = ${key.kind} and classreach_id = ${key.id}`;
	}
	return { ok: true, count: keys.length };
}

// Inside db().begin; queries must use the transaction (the pool holds one connection).
type Tx = ReturnType<typeof db>;

/**
 * Import the approved entries. `targets` overrides the family for an entry
 * (a family id, or 'new' for a guardian), which is how a conflict is settled.
 * Guardians go first, so a student approved with them finds the new family.
 * Entries that still need a decision are left alone and counted.
 */
export async function importClassReach(input: { keys: string[]; targets?: Record<string, string>; by: string }): Promise<Result<{ imported: number; needsDecision: number }>> {
	const wanted = new Set(input.keys);
	const targets = input.targets ?? {};
	if (!wanted.size) return { ok: false, error: 'Choose what to import first.' };
	let imported = 0, needsDecision = 0;
	for (const kind of ['guardian', 'student'] as const) {
		const plan = await classReachMatch();
		const familyIds = new Set(plan.families.map((family) => family.id));
		for (const item of plan.items) {
			if (item.kind !== kind || !wanted.has(item.key) || item.status === 'imported' || item.status === 'skipped') continue;
			const target = targets[item.key] || '';
			const step = decide(item, target, familyIds);
			if (!step) { needsDecision += 1; continue; }
			try {
				await db().begin(async (tx) => { await apply(tx as unknown as Tx, item, step, input.by); });
				imported += 1;
			} catch {
				// Changed since the dry run (an email taken meanwhile, say): leave it for a decision.
				needsDecision += 1;
			}
		}
	}
	return { ok: true, imported, needsDecision };
}

type Step = { action: Exclude<ClassReachMatchAction, 'none'>; familyId: string | null };
function decide(item: ClassReachMatchItem, target: string, familyIds: Set<string>): Step | null {
	if (target && target !== 'new' && !familyIds.has(target)) return null;
	if (item.kind === 'guardian') {
		if (!item.email || item.reason.includes('student’s own sign-in')) return null;
		const owned = item.status === 'matched' || (item.basis === 'Email' && item.candidates.length > 1);
		if (target === 'new') return owned ? null : { action: 'create_family', familyId: null };
		if (target) {
			if (item.status === 'matched') return target === item.familyId ? { action: 'link', familyId: target } : null;
			return owned ? null : { action: 'add_guardian', familyId: target };
		}
		if (item.status === 'matched') return { action: 'link', familyId: item.familyId };
		if (item.status === 'new') return { action: 'create_family', familyId: null };
		return null;
	}
	if (target && target !== 'new') return { action: target === item.familyId && item.childId ? 'link_child' : 'add_child', familyId: target };
	if (item.status === 'matched' || item.status === 'new') return { action: item.action as Step['action'], familyId: item.familyId };
	return null;
}

async function apply(tx: Tx, item: ClassReachMatchItem, step: Step, by: string): Promise<void> {
	const log = (familyId: string, kind: 'note' | 'joined', note: string) =>
		tx`insert into family_activity (id, family_id, by, kind, note) values (${randomUUID()}, ${familyId}, ${by}, ${kind}, ${note})`;
	const stage = async (familyId: string) => {
		if (item.kind === 'student') {
			await tx`update classreach_students set family_id = ${familyId}, approval = 'approved' where classreach_id = ${item.classreachId}`;
			return;
		}
		if (item.key.startsWith('g:')) await tx`update classreach_guardians set family_id = ${familyId}, approval = 'approved' where classreach_id = ${item.classreachId}`;
		else await tx`update classreach_families set family_id = ${familyId}, approval = 'approved' where classreach_id = ${item.classreachId}`;
		// The household row the pull derives from a guardian's email.
		if (item.email) await tx`update classreach_families set family_id = ${familyId}, approval = 'approved' where lower(email) = ${item.email}`;
	};
	const [first, ...rest] = item.name.split(' ');
	if (step.action === 'link') {
		await stage(step.familyId!);
		await log(step.familyId!, 'note', `Matched to ClassReach: ${item.name} (${item.email})`);
		return;
	}
	if (step.action === 'create_family' || step.action === 'add_guardian') {
		const [taken] = await tx`select 1 from family_emails where email = ${item.email} union select 1 from families where lower(email) = ${item.email} and merged_into_id is null`;
		if (taken) throw new Error(`${item.email} is already in the portal`);
		const familyId = step.familyId ?? randomUUID();
		if (step.action === 'create_family') {
			await tx`insert into families (id, name, first_name, last_name, email, phone, password_hash, roles) values (${familyId}, ${item.name}, ${first}, ${rest.join(' ')}, ${item.email}, ${''}, ${''}, ${['prospect']})`;
		}
		const personId = randomUUID();
		await tx`insert into family_people (id, family_id, name) values (${personId}, ${familyId}, ${item.name})`;
		await tx`insert into family_emails (id, family_id, email, is_primary, label, person_id) values (${randomUUID()}, ${familyId}, ${item.email}, ${step.action === 'create_family'}, ${step.action === 'create_family' ? '' : item.name}, ${personId})`;
		if (step.action === 'create_family') {
			await tx`insert into notification_routes (family_id, category, email, is_default) select ${familyId}::uuid, category, ${item.email}, true from unnest(${[...NOTIFICATION_CATEGORIES]}::text[]) as category on conflict do nothing`;
		}
		await stage(familyId);
		await log(familyId, step.action === 'create_family' ? 'note' : 'joined', step.action === 'create_family'
			? `Imported from ClassReach: ${item.name} (${item.email}). No email was sent.`
			: `Added ${item.name} (${item.email}) as a guardian from ClassReach. No email was sent.`);
		return;
	}
	const familyId = step.familyId!;
	const [already] = await tx`select id from children where classreach_id = ${item.classreachId}`;
	if (already) return;
	let childId = step.action === 'link_child' ? item.childId : null;
	if (!childId) {
		// An admin-picked family may already list this child by name.
		const rows = await tx`select id, name from children where family_id = ${familyId} and classreach_id is null`;
		const same = rows.find((row) => nameKey(String(row.name)) === nameKey(item.name));
		childId = same ? String(same.id) : null;
	}
	const year = schoolYearOf();
	if (childId) {
		await tx`update children set classreach_id = ${item.classreachId}, kind = 'student', grade = case when grade = '' then ${item.grade} else grade end, school_year = case when school_year = '' then ${year} else school_year end where id = ${childId}`;
	} else {
		childId = randomUUID();
		const [{ n }] = await tx`select coalesce(max(position) + 1, 0)::int as n from children where family_id = ${familyId}`;
		await tx`insert into children (id, family_id, kind, name, grade, school_year, position, classreach_id) values (${childId}, ${familyId}, 'student', ${item.name}, ${item.grade}, ${year}, ${n}, ${item.classreachId})`;
	}
	await tx`insert into enrollments (id, child_id, school_year, grade, status) values (${randomUUID()}, ${childId}, ${year}, ${item.grade}, 'enrolled') on conflict (child_id, school_year) do nothing`;
	await tx`update families set roles = array(select distinct unnest(array_remove(roles, 'prospect') || array['guardian'])) where id = ${familyId}`;
	await stage(familyId);
	await log(familyId, 'note', `${item.name} imported from ClassReach as a current student${item.grade ? ` (${item.grade === 'K' ? 'Kindergarten' : `grade ${item.grade}`})` : ''}.`);
}
