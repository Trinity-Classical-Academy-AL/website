import type { AstroGlobal } from 'astro';
import { runActions } from '../actions.ts';
import { csrfToken } from '../security.ts';
import { staffViewer } from '../classroom.ts';
import { canSeeChild, listStudents, listThreads, postMessage, teachingFor, threadMessages } from '@tca/school';

/**
 * Messages about students, for a family (/g/messages) or staff (/staff/messages):
 * the conversations they can see, the open one, and who they can start one about.
 */
export async function loadMessages(Astro: AstroGlobal, asFamily: boolean) {
	const family = Astro.locals.family!;
	const base = asFamily ? '/g/messages' : '/staff/messages';
	const viewer = asFamily ? { familyId: family.id, email: (Astro.locals.sessionEmail || family.email).toLowerCase(), admin: false, staff: false } : staffViewer(Astro);
	const csrf = csrfToken(Astro.cookies, Astro.url.protocol === 'https:');
	const result = await runActions(Astro, {
		post: async (form) => {
			const childId = String(form.get('childId') ?? '');
			if (!(await canSeeChild(childId, viewer))) return { error: 'You can’t write about that student.' };
			const outcome = await postMessage({ childId, body: String(form.get('body') ?? ''), author: { email: viewer.email, name: family.name || viewer.email }, fromFamily: asFamily });
			return outcome.ok ? { redirect: `${base}?child=${childId}` } : { error: outcome.error };
		},
	});
	if ('redirect' in result) return Astro.redirect(result.redirect, result.status);
	const threads = await listThreads(viewer);
	const startable = asFamily ? (await listStudents(family.id)).map((kid) => ({ id: kid.id, name: kid.name }))
		: [...new Map((await teachingFor(viewer.email, viewer.admin)).classes.flatMap((row) => row.students).map((kid) => [kid.id, { id: kid.id, name: kid.name }])).values()].sort((a, b) => a.name.localeCompare(b.name));
	const childId = Astro.url.searchParams.get('child') || '';
	const thread = threads.find((item) => item.childId === childId);
	const allowed = !!childId && (await canSeeChild(childId, viewer));
	const open = allowed ? { childId, childName: thread?.childName ?? startable.find((kid) => kid.id === childId)?.name ?? 'Student', messages: thread ? await threadMessages(thread.id, asFamily ? `family:${family.id}` : viewer.email) : [] } : null;
	return { base, csrf, error: result.error, threads, open, startable, me: viewer.email, asFamily };
}
