import { randomUUID } from 'node:crypto';
import { db, dbReady } from './db.ts';
import { schoolYearOf } from './applications.ts';
import { routeEmail } from './accounts.ts';
import { portalOrigin } from './email.ts';
import { sendTemplate } from './email-catalog.ts';
import { threadMessages, type Message, type Viewer } from './classroom.ts';
import type { Result } from './result.ts';

/**
 * Direct and group conversations, beside the per-student ones in classroom.ts.
 *
 * Direct: two participants. A participant is a person's sign-in email (staff,
 * admins) or a whole family (family:<id>, so every guardian sees it). Staff and
 * admins write to each other; a teacher writes to the families of students they
 * teach, an admin to any family. Families reply but don't start them, and never
 * write to other families.
 *
 * Group: one shared thread. Automatic groups follow roles and class assignments
 * (All staff, Admins, Teachers, one team per grade), so nobody maintains them.
 * Custom groups (Ed Council, room parents) are made by admins and can hold anyone
 * with a sign-in. Every member reads and writes. Student sign-ins are left out of both.
 */

export type GroupInfo = { key: string; name: string; auto: boolean; members: string[] };
export type Conversation = { kind: 'direct' | 'group'; key: string; title: string; subtitle: string; lastAt: string | null; lastBody: string; unread: boolean };
export type Person = { email: string; name: string; role: 'Admin' | 'Teacher' | 'Family' };

const ORDINAL = (grade: string) => grade === 'K' ? 'Kindergarten' : /^\d+$/.test(grade) ? `${grade}${({ '1': 'st', '2': 'nd', '3': 'rd' } as Record<string, string>)[grade] ?? 'th'} Grade` : `Grade ${grade}`;
const gradeOrder = (grade: string) => grade === 'K' ? 0 : Number(grade) || 99;

/** This viewer's participant key in direct conversations. */
export const participantKey = (viewer: Viewer) => viewer.staff || viewer.admin ? viewer.email.toLowerCase() : `family:${viewer.familyId}`;
const dmKey = (a: string, b: string) => [a, b].sort().join('|');
const otherIn = (key: string, me: string) => key.split('|').find((part) => part !== me) ?? me;

/** Everyone with a sign-in (not student sign-ins), with their name and what they are at school. */
export async function messagePeople(): Promise<Person[]> {
	await dbReady();
	const rows = await db()`
		select e.email, e.roles, coalesce(nullif(p.name, ''), nullif(e.label, ''), nullif(f.name, ''), e.email) as name
		from family_emails e join families f on f.id = e.family_id left join family_people p on p.id = e.person_id
		where e.child_id is null and f.merged_into_id is null order by 3`;
	return rows.map((row) => {
		const roles = (row.roles ?? []) as string[];
		return { email: String(row.email).toLowerCase(), name: String(row.name), role: roles.includes('admin') ? 'Admin' : roles.includes('staff') ? 'Teacher' : 'Family' };
	});
}

/** Every group: the automatic ones (members worked out now) and the custom ones. */
export async function listGroups(): Promise<GroupInfo[]> {
	await dbReady();
	const year = schoolYearOf();
	const [people, teaching, custom, members] = await Promise.all([
		db()`select lower(email) as email, roles from family_emails where child_id is null and roles && ${['admin', 'staff']}::text[]`,
		db()`select cl.grade, lower(t.email) as email from classes cl
			cross join lateral (select cl.teacher_email as email union select co.teacher_email from courses co where co.class_id = cl.id) t
			where cl.school_year = ${year} and cl.grade <> '' and t.email <> ''`,
		db()`select id, name from chat_groups order by lower(name)`,
		db()`select group_id, lower(email) as email from chat_group_members`,
	]);
	const withRole = (role: string) => people.filter((row) => (row.roles as string[]).includes(role)).map((row) => String(row.email));
	const unique = (list: string[]) => [...new Set(list)].sort();
	const grades = unique(teaching.map((row) => String(row.grade))).sort((a, b) => gradeOrder(a) - gradeOrder(b));
	return [
		{ key: 'auto:staff', name: 'All staff', auto: true, members: unique([...withRole('admin'), ...withRole('staff')]) },
		{ key: 'auto:admins', name: 'Admins', auto: true, members: unique(withRole('admin')) },
		{ key: 'auto:teachers', name: 'Teachers', auto: true, members: unique(withRole('staff')) },
		...grades.map((grade) => ({ key: `auto:grade:${grade}`, name: `${ORDINAL(grade)} team`, auto: true, members: unique(teaching.filter((row) => String(row.grade) === grade).map((row) => String(row.email))) })),
		...custom.map((row) => ({ key: `group:${row.id}`, name: String(row.name), auto: false, members: unique(members.filter((item) => String(item.group_id) === String(row.id)).map((item) => String(item.email))) })),
	];
}

/** The groups this person is in. */
export async function groupsOf(email: string): Promise<GroupInfo[]> {
	const me = email.toLowerCase();
	return (await listGroups()).filter((group) => group.members.includes(me));
}

/** Families a teacher teaches a child of (this school year); every family with a sign-in for admins. */
async function reachableFamilies(viewer: Viewer): Promise<{ key: string; name: string }[]> {
	if (!viewer.staff && !viewer.admin) return [];
	const rows = viewer.admin
		? await db()`select f.id, coalesce(nullif(f.household_name, ''), f.name) as name from families f where f.merged_into_id is null and exists (select 1 from family_emails e where e.family_id = f.id and e.child_id is null) order by 2`
		: await db()`select distinct f.id, coalesce(nullif(f.household_name, ''), f.name) as name from class_students cs join classes cl on cl.id = cs.class_id join children c on c.id = cs.child_id join families f on f.id = c.family_id
			where cl.school_year = ${schoolYearOf()} and (cl.teacher_email = ${viewer.email} or exists (select 1 from courses co where co.class_id = cl.id and co.teacher_email = ${viewer.email})) order by 2`;
	return rows.map((row) => ({ key: `family:${row.id}`, name: String(row.name) }));
}

/** Who this person can start a conversation with: their groups, staff (for staff), and the families they can reach. */
export async function messageTargets(viewer: Viewer): Promise<{ groups: { key: string; name: string }[]; staff: { key: string; name: string; role: string }[]; families: { key: string; name: string }[] }> {
	await dbReady();
	if (viewer.studentId) return { groups: [], staff: [], families: [] };
	const me = viewer.email.toLowerCase();
	const [groups, people, families] = await Promise.all([visibleGroups(viewer), viewer.staff || viewer.admin ? messagePeople() : Promise.resolve([] as Person[]), reachableFamilies(viewer)]);
	return {
		groups: groups.map((group) => ({ key: group.key, name: group.name })),
		staff: people.filter((person) => person.role !== 'Family' && person.email !== me).map((person) => ({ key: person.email, name: person.name, role: person.role })),
		families,
	};
}

/** Can this viewer write to `other` directly? Families only reply to a conversation the school started. */
export async function canDirect(viewer: Viewer, other: string): Promise<boolean> {
	await dbReady();
	if (viewer.studentId) return false;
	const me = participantKey(viewer);
	other = other.trim().toLowerCase();
	if (!other || other === me) return false;
	if (!viewer.staff && !viewer.admin) {
		const [thread] = await db()`select 1 from message_threads where dm_key = ${dmKey(me, other)}`;
		return !!thread;
	}
	if (other.startsWith('family:')) return (await reachableFamilies(viewer)).some((family) => family.key === other);
	const [person] = await db()`select 1 from family_emails where lower(email) = ${other} and child_id is null and roles && ${['admin', 'staff']}::text[]`;
	return !!person;
}

/**
 * The groups this viewer sees in this inbox. Staff see all of theirs in the staff
 * inbox; the family inbox shows custom groups, and only to people without staff
 * access (a teacher who is also a parent keeps groups in one place).
 */
async function visibleGroups(viewer: Viewer): Promise<GroupInfo[]> {
	if (viewer.studentId) return [];
	const groups = await groupsOf(viewer.email);
	if (viewer.staff || viewer.admin) return groups;
	const [staff] = await db()`select 1 from family_emails where lower(email) = ${viewer.email.toLowerCase()} and roles && ${['admin', 'staff']}::text[]`;
	return staff ? [] : groups.filter((group) => !group.auto);
}

async function canGroup(viewer: Viewer, key: string): Promise<GroupInfo | null> {
	return (await visibleGroups(viewer)).find((group) => group.key === key) ?? null;
}

async function displayName(key: string): Promise<string> {
	if (key.startsWith('family:')) {
		const [row] = await db()`select coalesce(nullif(household_name, ''), name) as name from families where id::text = ${key.slice(7)}`;
		return String(row?.name ?? 'A family');
	}
	const [row] = await db()`select coalesce(nullif(p.name, ''), nullif(e.label, ''), nullif(f.name, ''), e.email) as name from family_emails e join families f on f.id = e.family_id left join family_people p on p.id = e.person_id where lower(e.email) = ${key}`;
	return String(row?.name ?? key);
}

async function roleOf(key: string): Promise<string> {
	if (key.startsWith('family:')) return 'Family';
	const [row] = await db()`select roles from family_emails where lower(email) = ${key}`;
	const roles = (row?.roles ?? []) as string[];
	return roles.includes('admin') ? 'Admin' : roles.includes('staff') ? 'Teacher' : '';
}

/**
 * This person's direct and group conversations, newest first. Groups they
 * belong to are listed even before anyone has written in them.
 */
export async function listConversations(viewer: Viewer): Promise<Conversation[]> {
	await dbReady();
	if (viewer.studentId) return [];
	const me = participantKey(viewer), reader = me;
	const [direct, groups] = await Promise.all([
		db()`select t.id, t.dm_key, t.last_at from message_threads t where t.kind = 'direct' and (split_part(t.dm_key, '|', 1) = ${me} or split_part(t.dm_key, '|', 2) = ${me}) and exists (select 1 from messages m where m.thread_id = t.id)`,
		visibleGroups(viewer),
	]);
	const groupThreads = groups.length ? await db()`select id, group_key, last_at from message_threads where group_key = any(${groups.map((group) => group.key)})` : [];
	const ids = [...direct, ...groupThreads].map((row) => String(row.id));
	const [lasts, reads] = ids.length ? await Promise.all([
		db()`select distinct on (thread_id) thread_id, body, author_email from messages where thread_id = any(${ids}::uuid[]) order by thread_id, created_at desc`,
		db()`select thread_id, read_at from message_reads where reader = any(${[reader, viewer.email.toLowerCase()]}) and thread_id = any(${ids}::uuid[])`,
	]) : [[], []];
	const state = (row: { id: unknown; last_at: unknown }) => {
		const last = lasts.find((item) => String(item.thread_id) === String(row.id));
		const read = reads.find((item) => String(item.thread_id) === String(row.id));
		const mine = String(last?.author_email ?? '').toLowerCase() === viewer.email.toLowerCase();
		return { lastAt: new Date(row.last_at as string).toISOString(), lastBody: String(last?.body ?? '').slice(0, 140), unread: !!last && !mine && (!read || new Date(read.read_at) < new Date(row.last_at as string)) };
	};
	const others = direct.map((row) => otherIn(String(row.dm_key), me));
	const [names, roles] = await Promise.all([Promise.all(others.map(displayName)), Promise.all(others.map(roleOf))]);
	const list: Conversation[] = [
		...direct.map((row, index) => ({ kind: 'direct' as const, key: others[index], title: names[index], subtitle: roles[index], ...state(row) })),
		...groups.map((group) => {
			const row = groupThreads.find((item) => String(item.group_key) === group.key);
			return { kind: 'group' as const, key: group.key, title: group.name, subtitle: `${group.members.length} ${group.members.length === 1 ? 'person' : 'people'}`, ...(row ? state(row) : { lastAt: null, lastBody: '', unread: false }) };
		}),
	];
	return list.sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? '') || a.title.localeCompare(b.title));
}

/** One direct or group conversation, marked read for this person; null when they can't see it. */
export async function openConversation(viewer: Viewer, kind: 'direct' | 'group', key: string): Promise<{ kind: 'direct' | 'group'; key: string; title: string; subtitle: string; members: string[]; messages: Message[] } | null> {
	await dbReady();
	if (kind === 'group') {
		const group = await canGroup(viewer, key);
		if (!group) return null;
		const [thread] = await db()`select id from message_threads where group_key = ${key}`;
		const people = await messagePeople();
		const members = group.members.map((email) => people.find((person) => person.email === email)?.name ?? email);
		return { kind, key, title: group.name, subtitle: `${members.length} ${members.length === 1 ? 'person' : 'people'}`, members, messages: thread ? await threadMessages(String(thread.id), viewer.email.toLowerCase()) : [] };
	}
	const other = key.trim().toLowerCase();
	if (!(await canDirect(viewer, other))) return null;
	const me = participantKey(viewer);
	const [thread] = await db()`select id from message_threads where dm_key = ${dmKey(me, other)}`;
	const [title, role] = await Promise.all([displayName(other), roleOf(other)]);
	return { kind, key: other, title, subtitle: role, members: [], messages: thread ? await threadMessages(String(thread.id), me) : [] };
}

async function threadId(kind: 'direct' | 'group', key: string, subject: string): Promise<string> {
	const [row] = kind === 'direct'
		? await db()`insert into message_threads (id, kind, dm_key, subject) values (${randomUUID()}, 'direct', ${key}, ${subject}) on conflict (dm_key) where dm_key is not null do update set subject = message_threads.subject returning id`
		: await db()`insert into message_threads (id, kind, group_key, subject) values (${randomUUID()}, 'group', ${key}, ${subject}) on conflict (group_key) where group_key is not null do update set subject = excluded.subject returning id`;
	return String(row.id);
}

async function addMessage(thread: string, author: { email: string; name: string }, fromFamily: boolean, body: string, reader: string) {
	await db()`insert into messages (id, thread_id, author_email, author_name, from_family, body) values (${randomUUID()}, ${thread}, ${author.email}, ${author.name}, ${fromFamily}, ${body})`;
	await db()`update message_threads set last_at = now() where id = ${thread}`;
	await db()`insert into message_reads (thread_id, reader) values (${thread}, ${reader}) on conflict (thread_id, reader) do update set read_at = now()`;
}

const inboxFor = (role: string) => role === 'Family' || role === '' ? '/g/messages' : '/staff/messages';

/** Write to one person (or one family). */
export async function postDirect(viewer: Viewer, to: string, body: string, author: { email: string; name: string }): Promise<Result<{ key: string }>> {
	const text = body.trim().slice(0, 8000);
	if (!text) return { ok: false, error: 'Write a message first.' };
	const other = to.trim().toLowerCase();
	if (!(await canDirect(viewer, other))) return { ok: false, error: 'You can’t write to them here.' };
	const me = participantKey(viewer);
	const thread = await threadId('direct', dmKey(me, other), '');
	await addMessage(thread, author, me.startsWith('family:'), text, me);
	// They open the conversation keyed by us.
	if (other.startsWith('family:')) {
		const [family] = await db()`select email from families where id::text = ${other.slice(7)}`;
		if (family) await sendTemplate('message.direct', await routeEmail(other.slice(7), 'announcements', String(family.email)), { from: author.name, body: text, link: `${portalOrigin()}/g/messages?dm=${encodeURIComponent(me)}` });
	} else {
		await sendTemplate('message.direct', other, { from: author.name, body: text, link: `${portalOrigin()}${inboxFor(await roleOf(other))}?dm=${encodeURIComponent(me)}` });
	}
	return { ok: true, key: other };
}

/** Write to a group: every member sees it in the group's thread and gets an email. */
export async function postGroup(viewer: Viewer, key: string, body: string, author: { email: string; name: string }): Promise<Result<{ key: string }>> {
	const text = body.trim().slice(0, 8000);
	if (!text) return { ok: false, error: 'Write a message first.' };
	const group = await canGroup(viewer, key);
	if (!group) return { ok: false, error: 'You’re not in that group.' };
	const me = viewer.email.toLowerCase();
	const thread = await threadId('group', key, group.name);
	await addMessage(thread, author, !viewer.staff && !viewer.admin, text, me);
	const people = await messagePeople();
	for (const email of group.members) {
		if (email === me) continue;
		const role = people.find((person) => person.email === email)?.role ?? 'Family';
		await sendTemplate('message.group', email, { group: group.name, from: author.name, body: text, link: `${portalOrigin()}${inboxFor(role)}?group=${encodeURIComponent(key)}` });
	}
	return { ok: true, key };
}

/** Direct and group conversations with something new for this person (for the sidebar badge). */
export async function conversationUnread(viewer: Viewer): Promise<number> {
	return (await listConversations(viewer)).filter((item) => item.unread).length;
}

// ---------- Custom groups (admins) ----------
export async function saveGroup(input: { id?: string; name: string; members: string[]; by: string }): Promise<Result<{ id: string }>> {
	await dbReady();
	const name = input.name.trim().slice(0, 80);
	if (!name) return { ok: false, error: 'Name the group.' };
	const known = new Set((await messagePeople()).map((person) => person.email));
	const members = [...new Set(input.members.map((email) => email.trim().toLowerCase()))].filter((email) => known.has(email));
	if (!members.length) return { ok: false, error: 'Add at least one person.' };
	const id = input.id || randomUUID();
	await db().begin(async (tx) => {
		await tx`insert into chat_groups (id, name, created_by) values (${id}, ${name}, ${input.by}) on conflict (id) do update set name = excluded.name`;
		await tx`delete from chat_group_members where group_id = ${id} and not (email = any(${members}))`;
		for (const email of members) await tx`insert into chat_group_members (group_id, email) values (${id}, ${email}) on conflict do nothing`;
		await tx`update message_threads set subject = ${name} where group_key = ${`group:${id}`}`;
	});
	return { ok: true, id };
}

/** Deletes a custom group and its conversation. */
export async function deleteGroup(id: string): Promise<void> {
	await dbReady();
	await db()`delete from message_threads where group_key = ${`group:${id}`}`;
	await db()`delete from chat_groups where id = ${id}`;
}
