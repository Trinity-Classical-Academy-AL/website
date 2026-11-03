import { GRADE_OPTIONS } from '../../../src/lib/admissions/defaults.ts';
import { formatTimeRange } from '../../../src/lib/admissions/dates.ts';

const gradeLabel = new Map(GRADE_OPTIONS.map((grade) => [grade.value, grade.label]));

export function peopleLabel(count: number): string {
	return count === 1 ? '1 person' : `${count} people`;
}

export function clockRange(start: string, end: string): string {
	return formatTimeRange(start, end).replace('–', ' to ');
}

export function shortDate(iso: string): string {
	const [year, month, day] = iso.split('-').map(Number);
	if (!year || !month || !day) return iso;
	return new Intl.DateTimeFormat('en-US', {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC',
	}).format(new Date(Date.UTC(year, month - 1, day)));
}

export function receivedLabel(iso: string): string {
	if (!iso) return '';
	return new Intl.DateTimeFormat('en-US', {
		timeZone: 'America/Chicago',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	}).format(new Date(iso));
}

export function gradeList(grades: string[]): string {
	return grades.map((grade) => gradeLabel.get(grade as (typeof GRADE_OPTIONS)[number]['value']) ?? grade).join(', ');
}
