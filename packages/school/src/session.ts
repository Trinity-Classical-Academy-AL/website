import { createHmac, timingSafeEqual } from 'node:crypto';

/** Constant-time string compare. A length mismatch still runs a compare. */
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

export const STAFF_COOKIE = 'tca_admin_session';
export const FAMILY_COOKIE = 'tca_family_session';
export const STAFF_SESSION_DAYS = 14;
export const FAMILY_SESSION_DAYS = 30;

function sign(secret: string, payload: Record<string, unknown>): string {
	const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
	const sig = createHmac('sha256', secret).update(body).digest('base64url');
	return `${body}.${sig}`;
}

function readPayload(secret: string, value: string): Record<string, unknown> | null {
	if (!secret || !value) return null;
	const dot = value.indexOf('.');
	if (dot <= 0) return null;
	const body = value.slice(0, dot);
	const sig = value.slice(dot + 1);
	const expected = createHmac('sha256', secret).update(body).digest('base64url');
	const left = Buffer.from(sig);
	const right = Buffer.from(expected);
	if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
	try {
		const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
		if (typeof parsed.exp !== 'number' || parsed.exp <= Date.now()) return null;
		return parsed;
	} catch {
		return null;
	}
}

export function readCookie(header: string | null, name: string): string {
	if (!header) return '';
	for (const part of header.split(';')) {
		const separator = part.indexOf('=');
		if (separator === -1) continue;
		if (part.slice(0, separator).trim() === name) return decodeURIComponent(part.slice(separator + 1).trim());
	}
	return '';
}

function cookie(name: string, value: string, maxAge: number, secure: boolean): string {
	const parts = [`${name}=${encodeURIComponent(value)}`, 'HttpOnly', 'Path=/', 'SameSite=Lax', `Max-Age=${maxAge}`];
	if (secure) parts.push('Secure');
	return parts.join('; ');
}

export function requestIsSecure(req: Request): boolean {
	const forwarded = req.headers.get('x-forwarded-proto');
	if (forwarded) return forwarded.split(',')[0].trim() === 'https';
	return new URL(req.url).protocol === 'https:';
}

export function staffSecret(): string {
	return process.env.TCA_ADMIN_TOKEN ?? '';
}

export function familySecret(): string {
	const secret = process.env.FAMILY_SESSION_SECRET || '';
	if (secret) return secret;
	if (process.env.CONTEXT === 'production') {
		throw new Error('Set FAMILY_SESSION_SECRET on the family portal site.');
	}
	return 'dev-family-secret';
}

export function issueStaffSession(now = Date.now()): string {
	const secret = staffSecret();
	if (!secret) throw new Error('Set TCA_ADMIN_TOKEN on the admin site.');
	const exp = now + STAFF_SESSION_DAYS * 24 * 60 * 60 * 1000;
	return sign(secret, { exp, role: 'staff' });
}

export function issueFamilySession(familyId: string, emailOrNow: string | number = '', now = Date.now()): string {
	const email = typeof emailOrNow === 'string' ? emailOrNow.trim().toLowerCase() : '';
	const stamp = typeof emailOrNow === 'number' ? emailOrNow : now;
	const exp = stamp + FAMILY_SESSION_DAYS * 24 * 60 * 60 * 1000;
	return sign(familySecret(), { exp, familyId, email });
}

export function staffSessionCookie(req: Request, now = Date.now()): string {
	return cookie(STAFF_COOKIE, issueStaffSession(now), STAFF_SESSION_DAYS * 24 * 60 * 60, requestIsSecure(req));
}

export function clearStaffCookie(req: Request): string {
	return cookie(STAFF_COOKIE, '', 0, requestIsSecure(req));
}

export function readStaffSession(req: Request, now = Date.now()): boolean {
	const payload = readPayload(staffSecret(), readCookie(req.headers.get('cookie'), STAFF_COOKIE));
	if (!payload || payload.role !== 'staff') return false;
	return typeof payload.exp === 'number' && payload.exp > now;
}

export function familySessionCookie(req: Request, familyId: string, now = Date.now()): string {
	return cookie(FAMILY_COOKIE, issueFamilySession(familyId, now), FAMILY_SESSION_DAYS * 24 * 60 * 60, requestIsSecure(req));
}

export function clearFamilyCookie(req: Request): string {
	return cookie(FAMILY_COOKIE, '', 0, requestIsSecure(req));
}

export function readFamilySession(req: Request): { familyId: string; email: string } {
	const payload = readPayload(familySecret(), readCookie(req.headers.get('cookie'), FAMILY_COOKIE));
	return {
		familyId: typeof payload?.familyId === 'string' ? payload.familyId : '',
		email: typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : '',
	};
}

export function readFamilyId(req: Request): string {
	return readFamilySession(req).familyId;
}
