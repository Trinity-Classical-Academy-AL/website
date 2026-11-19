const GRADES = ['K', '1', '2', '3', '4', '5', '6', '7', '8'] as const;
export function cleanGrades(values: string[]): string[] {
	return GRADES.filter((grade) => values.includes(grade));
}

export function clip(value: string, max: number): string {
	return value.trim().slice(0, max);
}

