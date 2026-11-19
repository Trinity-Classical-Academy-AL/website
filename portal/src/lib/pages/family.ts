import type { AstroGlobal } from 'astro';
import { runActions, redirectOnSuccess, toastFrom } from '../actions.ts';
import { csrfToken } from '../security.ts';
import { addGuardianEmail, getFamily, listSignInEmails, listStudents, removeStudent, saveStudent } from '@tca/school';

/** Load data, run the existing actions, then derive the page's render model. */
export async function loadFamily(Astro: AstroGlobal, family: NonNullable<AstroGlobal['locals']['family']>) {
	const subject = await getFamily(Astro.params.id || '');
	if (!subject) return Astro.redirect('/admin/families');
	const secure = Astro.url.protocol === 'https:';
	const csrf = csrfToken(Astro.cookies, secure);
	let error = '';
	const actionResult = await runActions(Astro, {
		student: async (form) => redirectOnSuccess(await saveStudent({
			familyId: subject.id, id: String(form.get('id') ?? '') || undefined,
			name: `${String(form.get('first') ?? '')} ${String(form.get('last') ?? '')}`.trim(), grade: String(form.get('grade') ?? ''), teacher: String(form.get('teacher') ?? ''),
		}), result => `/admin/families/${subject.id}?saved=${result.id}`),
		'remove-student': async (form) => {
			await removeStudent(String(form.get('id') ?? ''), subject.id);
			return { redirect: `/admin/families/${subject.id}` };
		},
		guardian: async (form) => redirectOnSuccess(await addGuardianEmail({ familyId: subject.id, email: String(form.get('email') ?? ''), label: String(form.get('label') ?? '') }), `/admin/families/${subject.id}?added=1`),
	});
	
	if ('redirect' in actionResult) return Astro.redirect(actionResult.redirect, actionResult.status);
	error = actionResult.error;
	const [students, emails] = await Promise.all([listStudents(subject.id), listSignInEmails(subject.id)]);
	const grades = ['K', '1', '2', '3', '4', '5', '6', '7', '8'];
	const sheet = Astro.url.searchParams.get('sheet');
	const editing = students.find((student) => student.id === Astro.url.searchParams.get('student'));
	const [editFirst, ...editRest] = (editing?.name ?? '').split(' ');
	const toast = toastFrom(Astro.url, { saved: 'Student saved.' });
	return { subject, csrf, error, students, emails, grades, sheet, editing, editFirst, editRest, toast };
}

export type FamilyView = Exclude<Awaited<ReturnType<typeof loadFamily>>, Response>;
