/** Escape a CSV cell and neutralize spreadsheet formulas. */
export function csvEscape(value: unknown): string {
	const text = value == null ? '' : String(value);
	const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
	if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
	return safe;
}

export function toCsv(rows: Record<string, unknown>[], columns: { key: string; label: string }[]): string {
	const header = columns.map((column) => csvEscape(column.label)).join(',');
	const body = rows
		.map((row) => columns.map((column) => csvEscape(row[column.key])).join(','))
		.join('\n');
	return `\uFEFF${header}\n${body}\n`;
}
