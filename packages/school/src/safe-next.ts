// Match the raw value: decoding or normalizing here would admit encoded redirects.
export function safeNext(value: string | null | undefined): string | null {
	if (value === 'tour' || value === '/tour') return '/tour';
	if (typeof value === 'string' && value.length === 42 && /^\/rsvp\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return value;
	return null;
}
