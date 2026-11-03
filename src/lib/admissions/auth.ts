import { createHmac, timingSafeEqual } from 'node:crypto';
import { TOUR_DEFAULTS } from './defaults.ts';

export const ADMIN_COOKIE = 'tca_admin_session';

function envValue(name: string): string {
	const fromProcess = process.env[name];
	if (fromProcess) return fromProcess;
	const netlify = (globalThis as { Netlify?: { env?: { get?: (key: string) => string | undefined } } }).Netlify;
	return netlify?.env?.get?.(name) ?? '';
}

export function getAdminToken(): string {
	return envValue(TOUR_DEFAULTS.adminTokenEnv);
}

export function getNotifyWebhookUrl(): string {
	return envValue(TOUR_DEFAULTS.notifyWebhookEnv);
}

export function getNotifyWebhookToken(): string {
	return envValue(TOUR_DEFAULTS.notifyTokenEnv);
}

/**
 * Constant-time string compare. A length mismatch still runs a compare so the
 * function does not return early on the first differing byte.
 */
export function tokensMatch(provided: string, expected: string): boolean {
	const left = Buffer.from(provided);
	const right = Buffer.from(expected);
	if (left.length === 0 || right.length === 0) {
		timingSafeEqual(Buffer.from('x'), Buffer.from('x'));
		return false;
	}
	if (left.length !== right.length) {
		timingSafeEqual(left, left);
		return false;
	}
	return timingSafeEqual(left, right);
}

export function signSession(secret: string, now = Date.now()): string {
	const exp = now + TOUR_DEFAULTS.sessionDays * 24 * 60 * 60 * 1000;
	const body = Buffer.from(JSON.stringify({ exp })).toString('base64url');
	const sig = createHmac('sha256', secret).update(body).digest('base64url');
	return `${body}.${sig}`;
}

export function verifySession(secret: string, cookieValue: string, now = Date.now()): boolean {
	if (!secret || !cookieValue) return false;
	const dot = cookieValue.indexOf('.');
	if (dot <= 0) return false;
	const body = cookieValue.slice(0, dot);
	const sig = cookieValue.slice(dot + 1);
	const expected = createHmac('sha256', secret).update(body).digest('base64url');
	const left = Buffer.from(sig);
	const right = Buffer.from(expected);
	if (left.length !== right.length || !timingSafeEqual(left, right)) return false;
	try {
		const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { exp?: unknown };
		return typeof parsed.exp === 'number' && parsed.exp > now;
	} catch {
		return false;
	}
}

export function readCookie(header: string | null, name: string): string {
	if (!header) return '';
	for (const part of header.split(';')) {
		const separator = part.indexOf('=');
		if (separator === -1) continue;
		const key = part.slice(0, separator).trim();
		if (key === name) return part.slice(separator + 1).trim();
	}
	return '';
}

const DEFAULT_ADMIN_ORIGINS = [
	'https://admin.trinityclassical.academy',
	'http://127.0.0.1:5173',
	'http://localhost:5173',
];

/** Origins allowed to call the staff API from another site. Comma-separated ADMIN_ORIGINS overrides this. */
export function allowedAdminOrigins(): string[] {
	const configured = envValue('ADMIN_ORIGINS');
	if (!configured) return DEFAULT_ADMIN_ORIGINS;
	return configured.split(',').map((origin) => origin.trim()).filter(Boolean);
}

export function isAllowedAdminOrigin(origin: string): boolean {
	return allowedAdminOrigins().includes(origin);
}

export function sessionCookieHeader(value: string, req: Request, maxAge: number): string {
	const forwarded = req.headers.get('x-forwarded-proto');
	const requestUrl = new URL(req.url);
	const secure = forwarded === 'https' || requestUrl.protocol === 'https:';
	let crossSite = false;
	const origin = req.headers.get('origin');
	if (origin) {
		try {
			crossSite = new URL(origin).host !== requestUrl.host;
		} catch {
			crossSite = false;
		}
	}
	const sameSite = crossSite && secure ? 'None' : 'Lax';
	const parts = [
		`${ADMIN_COOKIE}=${value}`,
		'HttpOnly',
		'Path=/',
		`SameSite=${sameSite}`,
		`Max-Age=${maxAge}`,
	];
	if (secure || sameSite === 'None') parts.push('Secure');
	return parts.join('; ');
}
