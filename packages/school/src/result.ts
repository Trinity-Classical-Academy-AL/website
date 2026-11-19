/** Mutation contracts shared by the apps; these types add no runtime properties. */
export type FieldErrors = Record<string, string>;
export type Result<T extends object = {}, E extends object = { fields?: FieldErrors }> =
	| ({ ok: true } & T)
	| ({ ok: false; error: string } & E);

/** Keep legacy copy variants explicit while sharing the field-count grammar. */
export function fieldErrorMessage(fields: object | number, options: { plural?: boolean; suffix?: string } = {}): string {
	const count = typeof fields === 'number' ? fields : Object.keys(fields).length;
	return `Fix ${count} ${count === 1 && !options.plural ? 'field' : 'fields'}${options.suffix ?? ' to save.'}`;
}
