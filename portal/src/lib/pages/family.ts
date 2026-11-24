import type { AstroGlobal } from 'astro';
import { runActions, redirectOnSuccess, toastFrom } from '../actions.ts';
import { csrfToken } from '../security.ts';
import {
	addFamilyNote, addGuardianEmail, addIncomingNote, answerJoinRequest, familyTourView, listJoinRequests, getFamily, grantRoles, incomingDate, listFamilyAccounts,
	listIncoming, listProspectChildren, listApplications, listGuardians, listSignInEmails, listStudents, listUpdateSignups, markContacted, readHouseholdName, 
	removeStudent, saveHouseholdName, saveStudent,
} from '@tca/school';
import { buildDirectory, familyFeed, interviewDates, nextStepActions } from './families.ts';
import { nextStep } from '../next-step.ts';

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
		...nextStepActions(Astro, by),
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
		note: async (form) => {
			const note = String(form.get('note') || '');
			return contactSaved(form.get('family') ? await addFamilyNote(subject.id, by, note) : await addIncomingNote(String(form.get('id') || ''), by, note));
		},
		// Staff can answer any join request, including two enrolled families.
		'join-answer': async (form) => {
			const result = await answerJoinRequest({ id: String(form.get('id') ?? ''), familyId: null, approve: form.get('answer') === 'approve', by, staff: true });
			return result.ok ? { redirect: `${self}?${form.get('answer') === 'approve' ? 'merged' : 'declined'}=1` } : { error: result.error };
		},
		contacted: async (form) => {
			for (const id of form.getAll('id').map(String)) {
				const outcome = contactSaved(await markContacted(id, by));
				if ('error' in outcome) return outcome;
			}
			return { redirect: self };
		},
	});
	if ('redirect' in actionResult) return Astro.redirect(actionResult.redirect, actionResult.status);

	const [students, emails, kids, tours, requests, accounts, inquiries, signups, householdName] = await Promise.all([
		listStudents(subject.id), listSignInEmails(subject.id), listProspectChildren(subject.id), familyTourView(subject.id),
		listJoinRequests(subject.id), listFamilyAccounts(), listIncoming(), listUpdateSignups(), readHouseholdName(subject.id),
	]);
	const guardians = await listGuardians(subject.id);
	// The same grouping as the Families list, so stage and follow-up always agree.
	const directory = buildDirectory(accounts, inquiries, signups, Date.now(), await listApplications()).find((row) => row.account?.id === subject.id) ?? null;
	const focus = directory?.inquiries.find((row) => row.status === 'new') ?? directory?.inquiries[0] ?? null;
	const feed = directory ? await familyFeed(directory) : [];
	const step = directory ? nextStep(directory, (await interviewDates()).get(subject.id) ?? null) : null;

	const grades = ['K', '1', '2', '3', '4', '5', '6', '7', '8'];
	const sheet = Astro.url.searchParams.get('sheet');
	const editing = students.find((student) => student.id === Astro.url.searchParams.get('student'));
	const [editFirst, ...editRest] = (editing?.name ?? '').split(' ');
	const toast = toastFrom(Astro.url, {
		saved: 'Student saved.', added: 'Email added.', renamed: 'Family name saved.', merged: 'Families combined.', declined: 'Request declined.',
		enrolled: () => `${subject.name || 'This family'} is enrolled. Add students below.`,
	});
	return {
		subject, householdName, displayName: householdName || subject.name || subject.email, self, csrf, error: actionResult.error, by, students, emails, guardians, kids, tours, requests, directory, focus, feed, step,
		grades, sheet, editing, editFirst, editRest, toast,
		confirmingEnroll: Astro.url.searchParams.get('enroll') === '1',
		contactedLabel: `${by} · ${incomingDate(new Date().toISOString())}`,
	};
}

export type FamilyView = Exclude<Awaited<ReturnType<typeof loadFamily>>, Response>;
