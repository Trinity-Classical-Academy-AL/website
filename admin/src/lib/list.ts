export function searchQuery(url: URL): string {
	return (url.searchParams.get('q') || '').trim().slice(0, 80);
}

export function wantsCsv(url: URL): boolean {
	return url.searchParams.get('format') === 'csv';
}

export function text(form: FormData, name: string): string {
	return String(form.get(name) ?? '').trim();
}
