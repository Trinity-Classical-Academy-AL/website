export function digits(value: string): string {
	const raw = value.replace(/\D/g, '');
	return raw.length === 11 && raw.startsWith('1') ? raw.slice(1) : raw;
}

export function validEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function text(form: FormData, name: string): string {
	return String(form.get(name) ?? '').trim();
}
