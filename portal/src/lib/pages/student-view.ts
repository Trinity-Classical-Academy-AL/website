import type { AstroGlobal } from 'astro';
import { pickTerm } from '../classroom.ts';
import { chicagoToday, childAttendance, childGrades, childReportCards, weekAgenda } from '@tca/school';

export const STUDENT_TABS = [['week', 'This week'], ['grades', 'Grades'], ['attendance', 'Attendance'], ['report', 'Report cards']] as const;
export type StudentTab = (typeof STUDENT_TABS)[number][0];

const addDays = (day: string, by: number) => new Date(Date.parse(`${day}T12:00:00Z`) + by * 86400000).toISOString().slice(0, 10);

/**
 * What one student's page shows for the open tab: the week's agenda, the
 * quarter's grades, attendance, or released report cards. Used by the family
 * (/g/students/<id>) and by the student themselves (/s).
 */
export async function loadStudentView(Astro: AstroGlobal, childId: string, tabs: readonly StudentTab[]) {
	const asked = Astro.url.searchParams.get('tab') as StudentTab | null;
	const tab: StudentTab = asked && tabs.includes(asked) ? asked : 'week';
	const today = chicagoToday();
	// On a weekend, the week ahead.
	const weekend = [0, 6].includes(new Date(`${today}T12:00:00Z`).getUTCDay());
	const anchor = /^\d{4}-\d{2}-\d{2}$/.test(Astro.url.searchParams.get('week') || '') ? Astro.url.searchParams.get('week')! : weekend ? addDays(today, 2) : today;
	const monday = (() => { const date = new Date(`${anchor}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7)); return date.toISOString().slice(0, 10); })();
	const { terms, term } = await pickTerm(Astro);
	const [agenda, grades, attendance, cards] = await Promise.all([
		tab === 'week' ? weekAgenda(childId, monday, addDays(monday, 6)) : Promise.resolve([]),
		tab === 'grades' && term ? childGrades(childId, term) : Promise.resolve([]),
		tab === 'attendance' ? childAttendance(childId) : Promise.resolve(null),
		tab === 'report' ? childReportCards(childId) : Promise.resolve([]),
	]);
	return { tab, today, monday, days: [0, 1, 2, 3, 4].map((offset) => addDays(monday, offset)), prevWeek: addDays(monday, -7), nextWeek: addDays(monday, 7), terms, term, agenda, grades, attendance, cards, tabs: STUDENT_TABS.filter(([key]) => tabs.includes(key)) };
}
export type StudentView = Awaited<ReturnType<typeof loadStudentView>>;
