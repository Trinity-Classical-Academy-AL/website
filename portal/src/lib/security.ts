import { randomBytes } from 'node:crypto';
import { emailOpensAdmin, tokensMatch } from '@tca/school';

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

export function roleHome(roles: string[], sessionEmail = ''): string {
	if (roles.includes('guardian')) return '/g';
	if (roles.includes('admin') && !roles.includes('prospect') && emailOpensAdmin(sessionEmail)) return '/admin';
	return '/home';
}

export function rememberTour(cookies: import('astro').AstroCookies, secure: boolean) {
	cookies.set(AFTER_LOGIN, '/tour', { httpOnly: true, sameSite: 'lax', path: '/', secure, maxAge: 60 * 60 });
}

export function landingAfterAuth(cookies: import('astro').AstroCookies, roles: string[], sessionEmail = ''): string {
	if (cookies.get(AFTER_LOGIN)?.value === '/tour') {
		cookies.delete(AFTER_LOGIN, { path: '/' });
		return '/tour';
	}
	return roleHome(roles, sessionEmail);
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
