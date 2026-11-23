import { randomBytes } from 'node:crypto';
import { emailOpensAdmin, tokensMatch, safeNext } from '@tca/school';
export { safeNext } from '@tca/school';

const COOKIE = 'tca_csrf';

export function csrfToken(cookies: import('astro').AstroCookies, secure: boolean): string {
	const current = cookies.get(COOKIE)?.value;
	if (current) return current;
	const token = randomBytes(32).toString('base64url');
	cookies.set(COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', secure });
	return token;
}

export function csrfOk(cookies: import('astro').AstroCookies, form: FormData): boolean {
	const expected = cookies.get(COOKIE)?.value ?? '';
	const provided = String(form.get('csrf') ?? '');
	return Boolean(expected) && tokensMatch(provided, expected);
}

export function clientKey(request: Request): string {
	const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
	return forwarded || 'local';
}

const AFTER_LOGIN = 'tca_after_login';

/** Where someone lands after signing in: Admin, else Staff, else their family home. */
/** What a student's own sign-in can open: their pages, their badges, and signing out. */
export function studentPathAllowed(path: string): boolean {
	return path === '/s' || path.startsWith('/s/') || path === '/sign-out' || path === '/api/badges';
}

export function roleHome(roles: string[], sessionEmail = ''): string {
	if (roles.includes('student')) return '/s';
	if (roles.includes('admin') && emailOpensAdmin(sessionEmail)) return '/admin';
	if (roles.includes('staff')) return '/staff';
	if (roles.includes('guardian')) return '/g';
	return '/home';
}

export function wantsTour(next: string | null): boolean {
	return next === 'tour' || next === '/tour';
}

export function rememberTour(cookies: import('astro').AstroCookies, secure: boolean) {
	rememberNext(cookies, secure, '/tour');
}

export function rememberNext(cookies: import('astro').AstroCookies, secure: boolean, next: string | null) {
	if (next === null) return;
	const path = safeNext(next);
	if (!path) { cookies.delete(AFTER_LOGIN, { path: '/' }); return; }
	cookies.set(AFTER_LOGIN, path, { httpOnly: true, sameSite: 'lax', path: '/', secure, maxAge: 60 * 60 });
}

export function pendingNext(cookies: import('astro').AstroCookies): string | null {
	return safeNext(cookies.get(AFTER_LOGIN)?.value);
}

export function landingAfterAuth(cookies: import('astro').AstroCookies, roles: string[], sessionEmail = ''): string {
	const path = pendingNext(cookies);
	cookies.delete(AFTER_LOGIN, { path: '/' });
	return path || roleHome(roles, sessionEmail);
}

const GOOGLE_STATE = 'tca_google_state';

export function beginGoogleState(cookies: import('astro').AstroCookies, secure: boolean, link = ''): string {
	const nonce = randomBytes(32).toString('base64url');
	cookies.set(GOOGLE_STATE, JSON.stringify({ nonce, next: pendingNext(cookies), link }), {
		httpOnly: true, sameSite: 'lax', path: '/', secure, maxAge: 10 * 60,
	});
	return nonce;
}

export function consumeGoogleState(cookies: import('astro').AstroCookies, state: string): { next: string | null; link: string } | null {
	const raw = cookies.get(GOOGLE_STATE)?.value;
	cookies.delete(GOOGLE_STATE, { path: '/' });
	try {
		const stored = JSON.parse(raw || 'null');
		if (!state || typeof stored?.nonce !== 'string' || !tokensMatch(state, stored.nonce)) return null;
		return { next: safeNext(stored.next), link: typeof stored.link === 'string' ? stored.link : '' };
	} catch { return null; }
}

export function originOk(request: Request): boolean {
	const origin = request.headers.get('origin');
	if (!origin) return true;
	try {
		return new URL(origin).host === new URL(request.url).host;
	} catch {
		return false;
	}
}
