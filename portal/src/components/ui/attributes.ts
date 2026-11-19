/** Bare data hooks in Astro templates serialize as an empty string, not "true". */
export function htmlAttributes<T extends Record<string, unknown>>(attributes: T): T {
	return Object.fromEntries(Object.entries(attributes).map(([key, value]) =>
		[key, key.startsWith('data-') && value === true ? '' : value])) as T;
}
