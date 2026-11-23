import type { AstroGlobal } from 'astro';
import { runActions, toastFrom } from '../actions.ts';
import { csrfToken } from '../security.ts';
import { staffViewer } from '../classroom.ts';
import { canSeeChild, childTeachers, db, dbReady, listConversations, listStudents, listThreads, messageTargets, openConversation, personName, postClassMessage, postDirect, postGroup, postMessage, teachingFor, threadMessages, type Message, type Viewer } from '@tca/school';

export type MessagesMode = 'family' | 'staff' | 'student';
const BASES: Record<MessagesMode, string> = { family: '/g/messages', staff: '/staff/messages', student: '/s/messages' };

export type InboxKind = 'student' | 'direct' | 'group';
export type InboxItem = { kind: InboxKind; href: string; title: string; subtitle: string; lastAt: string | null; lastBody: string; unread: boolean; on: boolean };
export type InboxOpen = {
	kind: InboxKind; key: string; title: string; subtitle: string; messages: Message[];
	teachers: { email: string; name: string; role: string }[]; members: string[];
};
export type InboxTargets = { label: string; options: { value: string; label: string }[] }[];

/**
 * Messages for a family (/g/messages), staff (/staff/messages) or a 7th–8th
 * grader (/s/messages), in one list: conversations about a student, direct
 * conversations (staff with each other and with families) and groups (automatic
 * ones from roles and classes, and custom ones). Teachers can also write to a
 * whole class.
 */
export async function loadMessages(Astro: AstroGlobal, mode: MessagesMode) {
	const family = Astro.locals.family!;
	const base = BASES[mode];
	const params = Astro.url.searchParams;
	const email = (Astro.locals.sessionEmail || family.email).toLowerCase();
	const viewer: Viewer = mode === 'staff' ? staffViewer(Astro)
		: mode === 'student' ? { familyId: family.id, studentId: Astro.locals.access?.studentId, email, admin: false, staff: false }
		: { familyId: family.id, email, admin: false, staff: false };
	const csrf = csrfToken(Astro.cookies, Astro.url.protocol === 'https:');
	const authorName = async () => mode === 'family' ? (await personName(email)) || family.name : mode === 'student' ? await studentName(viewer.studentId!) : await personName(email);
	const author = async () => ({ email, name: await authorName() });
	const teaching = mode === 'staff' ? await teachingFor(viewer.email, viewer.admin) : null;
	const toStudent = async (childId: string, body: string, to: string) => {
		if (!(await canSeeChild(childId, viewer))) return { error: 'You can’t write about that student.' };
		const outcome = await postMessage({ childId, body, author: await author(), fromFamily: mode !== 'staff', fromStudent: mode === 'student', to });
		return outcome.ok ? { redirect: `${base}?child=${childId}` } : { error: outcome.error };
	};
	const toDirect = async (key: string, body: string) => {
		const outcome = await postDirect(viewer, key, body, await author());
		return outcome.ok ? { redirect: `${base}?dm=${encodeURIComponent(outcome.key)}` } : { error: outcome.error };
	};
	const toGroup = async (key: string, body: string) => {
		const outcome = await postGroup(viewer, key, body, await author());
		return outcome.ok ? { redirect: `${base}?group=${encodeURIComponent(outcome.key)}` } : { error: outcome.error };
	};
	const text = (form: FormData, name: string) => String(form.get(name) ?? '');
	const result = await runActions(Astro, {
		post: (form) => toStudent(text(form, 'childId'), text(form, 'body'), text(form, 'to')),
		direct: (form) => toDirect(text(form, 'to'), text(form, 'body')),
		group: (form) => toGroup(text(form, 'key'), text(form, 'body')),
		// New message: the To picker says which kind (child:, dm:, group:).
		start: (form) => {
			const [kind, ...rest] = text(form, 'to').split(':');
			const key = rest.join(':');
			if (mode === 'student') return { error: 'Write in your conversation.' };
			return kind === 'child' ? toStudent(key, text(form, 'body'), '') : kind === 'dm' ? toDirect(key, text(form, 'body')) : kind === 'group' ? toGroup(key, text(form, 'body')) : { error: 'Choose who it’s for.' };
		},
		class: async (form) => {
			const classId = text(form, 'classId');
			if (!teaching?.classes.some((row) => row.id === classId)) return { error: 'You don’t teach that class.' };
			const outcome = await postClassMessage({ classId, body: text(form, 'body'), author: await author() });
			return outcome.ok ? { redirect: `${base}?sent=${outcome.sent}` } : { error: outcome.error };
		},
	});
	if ('redirect' in result) return Astro.redirect(result.redirect, result.status);

	const [threads, conversations] = await Promise.all([listThreads(viewer), listConversations(viewer)]);
	const startable = mode === 'family' ? (await listStudents(family.id)).map((kid) => ({ id: kid.id, name: kid.name }))
		: mode === 'student' ? [{ id: viewer.studentId!, name: await studentName(viewer.studentId!) }]
		: [...new Map(teaching!.classes.flatMap((row) => row.students).map((kid) => [kid.id, { id: kid.id, name: kid.name }])).values()].sort((a, b) => a.name.localeCompare(b.name));

	// What's open: a student's conversation (a student's page opens their own), a direct one, or a group.
	const childId = params.get('child') || (mode === 'student' ? viewer.studentId! : '');
	const dm = params.get('dm'), group = params.get('group');
	let open: InboxOpen | null = null;
	if (dm || group) {
		const found = await openConversation(viewer, dm ? 'direct' : 'group', (dm || group)!);
		if (found) open = { ...found, teachers: [] };
	} else if (childId && (await canSeeChild(childId, viewer))) {
		const thread = threads.find((item) => item.childId === childId);
		open = {
			kind: 'student', key: childId, members: [],
			title: thread?.childName ?? startable.find((kid) => kid.id === childId)?.name ?? await studentName(childId),
			subtitle: mode === 'staff' ? `With the ${thread?.familyName || 'family'}` : 'With the school',
			messages: thread ? await threadMessages(thread.id, mode === 'student' ? `student:${childId}` : mode === 'family' ? `family:${family.id}` : viewer.email) : [],
			teachers: mode === 'staff' ? [] : await childTeachers(childId),
		};
	}

	const view = (['students', 'direct', 'groups'] as const).find((value) => value === params.get('view')) ?? 'all';
	const items: InboxItem[] = [
		...threads.map((thread) => ({ kind: 'student' as const, href: `${base}?child=${thread.childId}`, title: thread.childName, subtitle: mode === 'staff' ? thread.familyName : '', lastAt: thread.lastAt, lastBody: thread.lastBody, unread: thread.unread, on: open?.kind === 'student' && open.key === thread.childId })),
		...conversations.map((item) => ({ kind: item.kind, href: `${base}?${item.kind === 'direct' ? 'dm' : 'group'}=${encodeURIComponent(item.key)}`, title: item.title, subtitle: item.subtitle, lastAt: item.lastAt, lastBody: item.lastBody, unread: item.unread, on: open?.kind === item.kind && open.key === item.key })),
	].map((item) => item.on ? { ...item, unread: false } : item) // opening it just marked it read
		.filter((item) => view === 'all' || (view === 'students' ? item.kind === 'student' : view === 'direct' ? item.kind === 'direct' : item.kind === 'group'))
		.sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? '') || a.title.localeCompare(b.title));
	const kinds = new Set([...threads.length ? ['students'] : [], ...conversations.map((item) => item.kind === 'direct' ? 'direct' : 'groups')]);

	// The New message picker.
	const compose = params.get('compose');
	let targets: InboxTargets = [];
	if (compose === 'new' && mode !== 'student') {
		const reach = await messageTargets(viewer);
		targets = [
			{ label: 'Groups', options: reach.groups.map((item) => ({ value: `group:${item.key}`, label: item.name })) },
			{ label: mode === 'family' ? 'Your students’ teachers' : 'About a student', options: startable.map((kid) => ({ value: `child:${kid.id}`, label: mode === 'family' ? `${kid.name}’s teachers` : kid.name })) },
			{ label: 'Staff', options: reach.staff.map((item) => ({ value: `dm:${item.key}`, label: `${item.name} · ${item.role}` })) },
			{ label: 'Families', options: reach.families.map((item) => ({ value: `dm:${item.key}`, label: item.name })) },
		].filter((group) => group.options.length);
	}
	const classes = mode === 'staff' ? teaching!.classes.filter((row) => row.students.length).map((row) => ({ id: row.id, name: row.name })) : [];
	const toast = toastFrom(Astro.url, { sent: (value) => `Sent to ${value} ${value === '1' ? 'family' : 'families'}.` });
	return { base, csrf, error: result.error, items, open, me: viewer.email, mode, classes, toast, compose, targets, view, kinds: [...kinds], preset: params.get('to') ?? '' };
}

async function studentName(childId: string): Promise<string> {
	await dbReady();
	const [row] = await db()`select name from children where id = ${childId}`;
	return String(row?.name ?? 'Student');
}
