import { chicagoToday, formatChicago, guardianForms, listFamilyApplications } from '@tca/school';
import { trackApplication } from './application-tracker.ts';

/** Everything a family should do next: open forms and application steps, overdue first. */
export type Todo = { title: string; context: string; href: string; badge: { label: string; tone: string }; due: string };

export async function familyTodos(familyId: string, withForms = true): Promise<Todo[]> {
	const [forms, applications] = await Promise.all([withForms ? guardianForms(familyId) : Promise.resolve([]), listFamilyApplications(familyId)]);
	const today = chicagoToday();
	const todos: Todo[] = [];
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
