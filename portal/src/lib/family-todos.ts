import { chicagoToday, familyReenrollment, formatChicago, guardianForms, listFamilyApplications, reenrollmentSeason, schoolYearOf, seasonOpen, shiftSchoolYear } from '@tca/school';
import { trackApplication } from './application-tracker.ts';

/** Everything a family should do next: open forms and application steps, overdue first. */
export type Todo = { title: string; context: string; href: string; badge: { label: string; tone: string }; due: string };

export async function familyTodos(familyId: string, withForms = true): Promise<Todo[]> {
	const current = schoolYearOf(), next = shiftSchoolYear(current, 1);
	const [forms, applications, season, reenroll] = await Promise.all([withForms ? guardianForms(familyId) : Promise.resolve([]), listFamilyApplications(familyId), reenrollmentSeason(next), familyReenrollment(familyId, current, next)]);
	const today = chicagoToday();
	const todos: Todo[] = [];
	// Re-enrollment: one item while any child is still waiting on the family's answer.
	const waiting = reenroll.filter((row) => row.status === 'pending');
	if (seasonOpen(season, today) && waiting.length) {
		todos.push({ title: `Tell us if ${waiting.map((row) => row.name.split(' ')[0]).join(' and ')} ${waiting.length === 1 ? 'is' : 'are'} returning for ${next}`, context: season?.deadline ? `Due ${formatChicago(`${season.deadline}T12:00:00Z`, false)}` : 'Re-enrollment', href: '/g/students', due: '0001', badge: { label: 'Re-enrollment', tone: 'b-gold' } });
	}
	for (const form of forms) {
		if (form.status === 'submitted') continue;
		const overdue = !!form.dueOn && form.dueOn < today;
		todos.push({
			title: form.title, href: `/g/forms/${form.id}`, due: form.dueOn || '9999',
			context: [`For ${form.student}`, form.dueOn && `Due ${formatChicago(`${form.dueOn}T12:00:00Z`, false)}`].filter(Boolean).join(' · '),
			badge: overdue ? { label: 'Overdue', tone: 'b-gold' } : form.status === 'draft' ? { label: 'Draft saved', tone: 'b-gray' } : { label: 'To do', tone: 'b-gray' },
		});
	}
	for (const app of applications) {
		const track = trackApplication(app);
		if (!track.todo) continue;
		todos.push({ title: track.todo, context: `${app.schoolYear} application`, href: '/applications', due: '0000', badge: { label: 'Application', tone: 'b-gold' } });
	}
	return todos.sort((a, b) => a.due.localeCompare(b.due));
}
