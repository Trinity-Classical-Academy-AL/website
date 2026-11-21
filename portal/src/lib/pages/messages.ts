import type { AstroGlobal } from 'astro';
import { runActions, toastFrom } from '../actions.ts';
import { csrfToken } from '../security.ts';
import { staffViewer } from '../classroom.ts';
import { canSeeChild, childTeachers, db, dbReady, listStudents, listThreads, personName, postClassMessage, postMessage, teachingFor, threadMessages, type Viewer } from '@tca/school';

export type MessagesMode = 'family' | 'staff' | 'student';
const BASES: Record<MessagesMode, string> = { family: '/g/messages', staff: '/staff/messages', student: '/s/messages' };

/**
 * Messages about students for a family (/g/messages), staff (/staff/messages)
 * or a 7th–8th grader (/s/messages): the conversations they can see, the open
 * one, who they can start one about, who a message can go to, and (for
 * teachers) the classes they can write to all at once.
 */
export async function loadMessages(Astro: AstroGlobal, mode: MessagesMode) {
	const family = Astro.locals.family!;
	const base = BASES[mode];
	const email = (Astro.locals.sessionEmail || family.email).toLowerCase();
	const viewer: Viewer = mode === 'staff' ? staffViewer(Astro)
		: mode === 'student' ? { familyId: family.id, studentId: Astro.locals.access?.studentId, email, admin: false, staff: false }
		: { familyId: family.id, email, admin: false, staff: false };
	const csrf = csrfToken(Astro.cookies, Astro.url.protocol === 'https:');
	const authorName = async () => mode === 'family' ? (await personName(email)) || family.name : mode === 'student' ? await studentName(viewer.studentId!) : await personName(email);
	const teaching = mode === 'staff' ? await teachingFor(viewer.email, viewer.admin) : null;
	const result = await runActions(Astro, {
		post: async (form) => {
			const childId = String(form.get('childId') ?? '');
			if (!(await canSeeChild(childId, viewer))) return { error: 'You can’t write about that student.' };
			const outcome = await postMessage({ childId, body: String(form.get('body') ?? ''), author: { email, name: await authorName() }, fromFamily: mode !== 'staff', fromStudent: mode === 'student', to: String(form.get('to') ?? '') });
			return outcome.ok ? { redirect: `${base}?child=${childId}` } : { error: outcome.error };
		},
		class: async (form) => {
			const classId = String(form.get('classId') ?? '');
			if (!teaching?.classes.some((row) => row.id === classId)) return { error: 'You don’t teach that class.' };
			const outcome = await postClassMessage({ classId, body: String(form.get('body') ?? ''), author: { email, name: await authorName() } });
			return outcome.ok ? { redirect: `${base}?sent=${outcome.sent}` } : { error: outcome.error };
		},
	});
	if ('redirect' in result) return Astro.redirect(result.redirect, result.status);
	const threads = await listThreads(viewer);
	const startable = mode === 'family' ? (await listStudents(family.id)).map((kid) => ({ id: kid.id, name: kid.name }))
		: mode === 'student' ? [{ id: viewer.studentId!, name: await studentName(viewer.studentId!) }]
		: [...new Map(teaching!.classes.flatMap((row) => row.students).map((kid) => [kid.id, { id: kid.id, name: kid.name }])).values()].sort((a, b) => a.name.localeCompare(b.name));
	// A student's page opens their own conversation straight away.
	const childId = Astro.url.searchParams.get('child') || (mode === 'student' ? viewer.studentId! : '');
	const thread = threads.find((item) => item.childId === childId);
	const allowed = !!childId && (await canSeeChild(childId, viewer));
	const open = allowed ? {
		childId,
		childName: thread?.childName ?? startable.find((kid) => kid.id === childId)?.name ?? await studentName(childId),
		messages: thread ? await threadMessages(thread.id, mode === 'student' ? `student:${childId}` : mode === 'family' ? `family:${family.id}` : viewer.email) : [],
		teachers: mode === 'staff' ? [] : await childTeachers(childId),
	} : null;
	const classes = mode === 'staff' ? teaching!.classes.filter((row) => row.students.length).map((row) => ({ id: row.id, name: row.name })) : [];
	const toast = toastFrom(Astro.url, { sent: (value) => `Sent to ${value} ${value === '1' ? 'family' : 'families'}.` });
	return { base, csrf, error: result.error, threads, open, startable, me: viewer.email, mode, classes, toast };
}

async function studentName(childId: string): Promise<string> {
	await dbReady();
	const [row] = await db()`select name from children where id = ${childId}`;
	return String(row?.name ?? 'Student');
}
