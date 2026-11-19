import type { AstroCookies } from 'astro';
import type { FieldErrors, Result } from '@tca/school';
import { csrfOk } from './security.ts';
export { fieldErrorMessage } from '@tca/school';

export type ActionOutcome<D = unknown> =
	| { redirect: string; status?: 301 | 302 | 303 | 307 | 308 }
	| { error?: string; fields?: FieldErrors; draft?: D; status?: number };
export type ActionContext<D> = { action: string; draft: D };
export type ActionHandler<D> = (form: FormData, ctx: ActionContext<D>) => ActionOutcome<D> | Promise<ActionOutcome<D>>;
type ActionOptions<D> = {
	/** Parse display-only state before CSRF, preserving drafts even on expiry. */
	draftFrom?: (form: FormData) => D;
	actionFrom?: (form: FormData) => string;
	fallback?: ActionHandler<D>;
	csrfFailure?: (error: string) => ActionOutcome<D>;
};
export type PageActionResult<D> =
	| { redirect: string; status?: 301 | 302 | 303 | 307 | 308 }
	| { error: string; fields: FieldErrors; draft: D | undefined; status?: number };

/** One POST boundary: parse once, check CSRF, dispatch, normalize for the page. */
export async function runActions<D = undefined>(
	page: { request: Request; cookies: AstroCookies },
	handlers: Record<string, ActionHandler<D>>,
	options: ActionOptions<D> = {},
): Promise<PageActionResult<D>> {
	const normalize = (outcome: ActionOutcome<D>, draft?: D): PageActionResult<D> =>
		'redirect' in outcome ? outcome : { ...outcome, error: outcome.error ?? '', fields: outcome.fields ?? {}, draft: outcome.draft ?? draft };
	if (page.request.method !== 'POST') return normalize({});
	const form = await page.request.formData();
	const draft = options.draftFrom?.(form);
	if (!csrfOk(page.cookies, form)) {
		const error = 'That request expired. Try again.';
		return normalize(options.csrfFailure?.(error) ?? { error }, draft);
	}
	const action = options.actionFrom?.(form) ?? String(form.get('action') ?? '');
	// Form values must never dispatch inherited object properties.
	const handler = Object.hasOwn(handlers, action) ? handlers[action] : options.fallback;
	return normalize(handler ? await handler(form, { action, draft: draft as D }) : {}, draft);
}

/** Both save and delete handlers return the same normalized outcome. */
export function redirectOnSuccess(result: Result<object>, target: string): ActionOutcome<never>;
export function redirectOnSuccess<T extends object>(result: Result<T>, target: (value: T) => string): ActionOutcome<never>;
export function redirectOnSuccess<T extends object>(result: Result<T>, target: string | ((value: T) => string)): ActionOutcome<never> {
	return result.ok ? { redirect: typeof target === 'function' ? target(result) : target } : { error: result.error, fields: result.fields };
}

type ToastMessage = string | ((value: string, url: URL) => string);
/** Ordered map retains each page's query precedence and exact toast copy. */
export function toastFrom(url: URL, map: Record<string, ToastMessage>): string {
	for (const [key, message] of Object.entries(map)) {
		const value = url.searchParams.get(key);
		if (value) return typeof message === 'function' ? message(value, url) : message;
	}
	return '';
}
