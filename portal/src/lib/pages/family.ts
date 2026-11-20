import type { AstroGlobal } from 'astro';
import { runActions, redirectOnSuccess, toastFrom } from '../actions.ts';
import { csrfToken } from '../security.ts';
import {
	addGuardianEmail, addIncomingNote, familyTourView, getFamily, grantRoles, incomingActivity, incomingDate, listFamilyAccounts,
	listIncoming, listProspectChildren, listSignInEmails, listStudents, listUpdateSignups, markContacted, readHouseholdName, readStaffNote,
	removeStudent, saveHouseholdName, saveStaffNote, saveStudent,
} from '@tca/school';
import { buildDirectory } from './families.ts';

/**
 * Full family page for any family with a portal account, prospect or enrolled.
 * Same model as the Families sheet (stage, follow-up, timeline), plus the parts
 * that need room: students, children, tours, sign-in emails and the staff note.
 */
export async function loadFamily(Astro: AstroGlobal, family: NonNullable<AstroGlobal['locals']['family']>) {
	const subject = await getFamily(Astro.params.id || '');
	if (!subject) return Astro.redirect('/admin/families');
	const csrf = csrfToken(Astro.cookies, Astro.url.protocol === 'https:');
	const self = `/admin/families/${subject.id}`;
	const by = Astro.locals.sessionEmail || family.email || family.name;
	const contactSaved = (result: object) => 'error' in result ? { error: String(result.error) }
		: 'skipped' in result ? { error: 'Contact updates are available in production.' } : { redirect: self };
	const actionResult = await runActions(Astro, {
		student: async (form) => redirectOnSuccess(await saveStudent({
			familyId: subject.id, id: String(form.get('id') ?? '') || undefined,
			name: `${String(form.get('first') ?? '')} ${String(form.get('last') ?? '')}`.trim(), grade: String(form.get('grade') ?? ''), teacher: String(form.get('teacher') ?? ''),
		}), result => `${self}?saved=${result.id}`),
		'remove-student': async (form) => {
			await removeStudent(String(form.get('id') ?? ''), subject.id);
			return { redirect: self };
		},
		guardian: async (form) => redirectOnSuccess(await addGuardianEmail({ familyId: subject.id, email: String(form.get('email') ?? ''), label: String(form.get('label') ?? '') }), `${self}?added=1`),
		enroll: async () => {
			await grantRoles(subject.id, Array.from(new Set([...subject.roles.filter((role) => role !== 'prospect'), 'guardian' as const])));
			return { redirect: `${self}?enrolled=1` };
		},
		'family-name': async (form) => {
			await saveHouseholdName(subject.id, String(form.get('name') ?? ''));
			return { redirect: `${self}?renamed=1` };
		},
		'staff-note': async (form) => {
			await saveStaffNote(subject.id, String(form.get('note') ?? ''));
			return { redirect: `${self}?noted=1` };
		},
		note: async (form) => contactSaved(await addIncomingNote(String(form.get('id') || ''), by, String(form.get('note') || ''))),
		contacted: async (form) => {
			for (const id of form.getAll('id').map(String)) {
				const outcome = contactSaved(await markContacted(id, by));
				if ('error' in outcome) return outcome;
			}
			return { redirect: self };
		},
	});
	if ('redirect' in actionResult) return Astro.redirect(actionResult.redirect, actionResult.status);

	const [students, emails, kids, tours, staffNote, accounts, inquiries, signups, householdName] = await Promise.all([
		listStudents(subject.id), listSignInEmails(subject.id), listProspectChildren(subject.id), familyTourView(subject.id),
		readStaffNote(subject.id), listFamilyAccounts(), listIncoming(), listUpdateSignups(), readHouseholdName(subject.id),
	]);
	// The same grouping as the Families list, so stage and follow-up always agree.
	const directory = buildDirectory(accounts, inquiries, signups).find((row) => row.account?.id === subject.id) ?? null;
	const focus = directory?.inquiries.find((row) => row.status === 'new') ?? directory?.inquiries[0] ?? null;
	const activity = focus ? await incomingActivity(focus.id) : [];

	const grades = ['K', '1', '2', '3', '4', '5', '6', '7', '8'];
	const sheet = Astro.url.searchParams.get('sheet');
	const editing = students.find((student) => student.id === Astro.url.searchParams.get('student'));
	const [editFirst, ...editRest] = (editing?.name ?? '').split(' ');
	const toast = toastFrom(Astro.url, {
		saved: 'Student saved.', added: 'Email added.', noted: 'Staff note saved.', renamed: 'Family name saved.',
		enrolled: () => `${subject.name || 'This family'} is enrolled. Add students below.`,
	});
	return {
		subject, householdName, displayName: householdName || subject.name || subject.email, self, csrf, error: actionResult.error, by, students, emails, kids, tours, staffNote, directory, focus, activity,
		grades, sheet, editing, editFirst, editRest, toast,
		confirmingEnroll: Astro.url.searchParams.get('enroll') === '1',
		contactedLabel: `${by} · ${incomingDate(new Date().toISOString())}`,
	};
}

export type FamilyView = Exclude<Awaited<ReturnType<typeof loadFamily>>, Response>;
