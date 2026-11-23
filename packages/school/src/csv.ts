/** Escape a CSV cell and neutralize spreadsheet formulas. */
export function csvEscape(value: unknown): string {
	const text = value == null ? '' : String(value);
	const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
	if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
	return safe;
}

export function toCsv(rows: Record<string, unknown>[], columns: { key: string; label: string }[]): string {
	const header = columns.map((column) => csvEscape(column.label)).join(',');
	const body = rows.map((row) => columns.map((column) => csvEscape(row[column.key])).join(',')).join('\n');
	return `\uFEFF${header}\n${body}\n`;
}

export function csvResponse(filename: string, body: string): Response {
	return new Response(body, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			// Header values must be plain ASCII ("2027–28" has an en dash).
			'content-disposition': `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, '-').replace(/"/g, '')}"`,
			'cache-control': 'no-store',
			'x-robots-tag': 'noindex, nofollow',
		},
	});
}

export function likePattern(query: string): string {
	const escaped = query.replace(/[\\%_]/g, (character) => `\\${character}`);
	return `%${escaped}%`;
}
