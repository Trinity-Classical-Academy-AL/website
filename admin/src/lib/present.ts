import { GRADE_OPTIONS } from '../../../src/lib/admissions/defaults.ts';
import { formatTimeRange } from '../../../src/lib/admissions/dates.ts';

const gradeLabel = new Map(GRADE_OPTIONS.map((grade) => [grade.value, grade.label]));

export function peopleLabel(count: number): string {
	return count === 1 ? '1 person' : `${count} people`;
}

export function clockRange(start: string, end: string): string {
	return formatTimeRange(start, end).replace('–', ' to ');
}

export { shortDateWithoutYear as shortDate, receivedLabel } from '@tca/school/time';

export function gradeList(grades: string[]): string {
	return grades.map((grade) => gradeLabel.get(grade as (typeof GRADE_OPTIONS)[number]['value']) ?? grade).join(', ');
}
