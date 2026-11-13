import { createHmac, timingSafeEqual } from 'node:crypto';

/** Read-only ClassReach client. Login is the only POST. Everything else is an allowlisted GET. */

export const CLASSREACH_ORIGIN = 'https://trinityclassicalacademy.classreach.com';
export const CLASSREACH_FETCH_TIMEOUT_MS = 10_000;
export const CLASSREACH_SYNC_HEADER = 'x-classreach-sync';

/** Bracket access so a bundler cannot bake an empty value in at build time. */
export function readClassReachEnv(env: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
	return {
		CLASSREACH_USERNAME: env['CLASSREACH_USERNAME'],
		CLASSREACH_PASSWORD: env['CLASSREACH_PASSWORD'],
		CLASSREACH_BASE_URL: env['CLASSREACH_BASE_URL'],
		CLASSREACH_SYNC_ENABLED: env['CLASSREACH_SYNC_ENABLED'],
	};
}

/** Hourly sync stays off until this is exactly "true". */
export function classReachSyncEnabled(env: Record<string, string | undefined>): boolean {
	return env['CLASSREACH_SYNC_ENABLED'] === 'true';
}

/** First failure and the recovery each send one email. Repeated failures do not. */
export function classReachAlertAction(previous: 'ok' | 'failing' | null, ok: boolean): 'fail' | 'recovered' | 'none' {
	if (!ok) return previous === 'failing' ? 'none' : 'fail';
	return previous === 'failing' ? 'recovered' : 'none';
}

export function cloudflareChallenge(status: number, headers: { get(name: string): string | null }, body = ''): boolean {
	if (status !== 403) return false;
	const mitigated = headers.get('cf-mitigated') || '';
	if (/challenge/i.test(mitigated)) return true;
	return /Just a moment|cf-browser-verification|challenge-platform|Attention Required/i.test(body);
}

/** Netlify's function log keeps console.log and drops console.info. */
export function logClassReach(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}) {
	const line = JSON.stringify({ at: new Date().toISOString(), level, event, ...fields });
	console.log(line);
	if (level === 'error') console.error(line);
}

/** The hourly function only queues this. The paced pull runs in the 15-minute background function. */
export async function queueClassReachSync(input: {
	env: Record<string, string | undefined>;
	site: string;
	secret: string;
	fetch: (url: string, init: { method: string; headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ status: number }>;
}): Promise<{ queued: boolean; status?: number; reason?: string }> {
	const usernameSet = Boolean(input.env.CLASSREACH_USERNAME);
	const passwordSet = Boolean(input.env.CLASSREACH_PASSWORD);
	logClassReach('info', 'classreach_sync_begin', { usernameSet, passwordSet, enabled: classReachSyncEnabled(input.env) });
	if (!classReachSyncEnabled(input.env)) {
		logClassReach('info', 'classreach_sync_skipped', { reason: 'disabled', events: 0, people: 0 });
		return { queued: false, reason: 'disabled' };
	}
	if (!usernameSet || !passwordSet) {
		logClassReach('info', 'classreach_sync_skipped', { reason: 'credentials-unset', events: 0, people: 0 });
		return { queued: false, reason: 'credentials-unset' };
	}
	const site = input.site.replace(/\/$/, '');
	if (!site || !input.secret) {
		logClassReach('error', 'classreach_sync_failed', { message: 'ClassReach sync could not be queued', events: 0, people: 0 });
		return { queued: false, reason: 'not-queued' };
	}
	const response = await input.fetch(`${site}/.netlify/functions/classreach-sync-background`, {
		method: 'POST',
		headers: { [CLASSREACH_SYNC_HEADER]: classReachSyncToken(input.secret) },
		signal: AbortSignal.timeout(CLASSREACH_FETCH_TIMEOUT_MS),
	});
	if (response.status !== 202 && response.status !== 200) {
		logClassReach('error', 'classreach_sync_failed', { message: `ClassReach queue returned ${response.status}`, status: response.status, events: 0, people: 0 });
		return { queued: false, status: response.status };
	}
	logClassReach('info', 'classreach_sync_queued', { status: response.status });
	return { queued: true, status: response.status };
}

export function bearerAuthorized(secret: string, header: string | null): boolean {
	if (!secret || !header) return false;
	const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
	if (!match) return false;
	const expected = Buffer.from(secret);
	const provided = Buffer.from(match[1]);
	if (expected.length !== provided.length || expected.length === 0) return false;
	return timingSafeEqual(expected, provided);
}

export function normalizeIngestBody(body: unknown): { events: StagedEvent[]; people: StagedPerson[] } | null {
	if (!body || typeof body !== 'object') return null;
	const record = body as { events?: unknown; people?: unknown };
	if (!Array.isArray(record.events) || !Array.isArray(record.people)) return null;
	if (record.events.length > 2000 || record.people.length > 5000) return null;
	const events: StagedEvent[] = [];
	for (const row of record.events) {
		if (!row || typeof row !== 'object') return null;
		const item = row as Record<string, unknown>;
		const classreachId = String(item.classreachId ?? '').trim();
		if (!classreachId || classreachId.length > 80) return null;
		events.push({
			classreachId,
			title: String(item.title ?? '').slice(0, 300),
			startsOn: String(item.startsOn ?? '').slice(0, 40),
			endsOn: String(item.endsOn ?? '').slice(0, 40),
			payload: item.payload ?? {},
		});
	}
	const people: StagedPerson[] = [];
	for (const row of record.people) {
		if (!row || typeof row !== 'object') return null;
		const item = row as Record<string, unknown>;
		const classreachId = String(item.classreachId ?? '').trim();
		const kind = item.kind;
		if (!classreachId || classreachId.length > 120) return null;
		if (kind !== 'family' && kind !== 'student' && kind !== 'guardian') return null;
		people.push({
			classreachId,
			kind,
			directoryId: String(item.directoryId ?? '').slice(0, 40),
			directoryName: String(item.directoryName ?? '').slice(0, 200),
			email: String(item.email ?? '').trim().toLowerCase().slice(0, 200),
			fullName: String(item.fullName ?? '').slice(0, 200),
			familyId: null,
			payload: item.payload ?? {},
		});
	}
	return { events, people };
}
export const MIN_GAP_MS = 1500;
export const HOUR_MS = 60 * 60 * 1000;
const SESSION_MS = 8 * 60 * 60 * 1000;
const USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';

const GET_PATHS = new Set([
	'/Login',
	'/UserSession/SelectRole',
	'/',
	'/Admin/School',
	'/Calendar/events',
	'/Directory',
	'/Directory/GetDirectoryInfo',
	'/Directory/GetDirectoryUserInfo',
]);

export type ClassReachCookie = { name: string; value: string };

export type ClassReachResponse = {
	status: number;
	headers: {
		get(name: string): string | null;
		getSetCookie(): string[];
	};
	text(): Promise<string>;
};

export type ClassReachFetch = (
	url: string,
	init: { method: string; headers: Record<string, string>; body?: string; redirect: 'manual'; signal?: AbortSignal },
) => Promise<ClassReachResponse>;

export function classReachSyncToken(secret: string): string {
	return createHmac('sha256', secret).update('classreach-sync').digest('hex');
}

export function classReachSyncAuthorized(secret: string, header: string | null): boolean {
	if (!secret || !header) return false;
	const expected = Buffer.from(classReachSyncToken(secret));
	const provided = Buffer.from(header);
	if (expected.length !== provided.length) return false;
	return timingSafeEqual(expected, provided);
}

export type StagedEvent = {
	classreachId: string;
	title: string;
	startsOn: string;
	endsOn: string;
	payload: unknown;
};

export type PersonKind = 'family' | 'student' | 'guardian';

export type StagedPerson = {
	classreachId: string;
	kind: PersonKind;
	directoryId: string;
	directoryName: string;
	email: string;
	fullName: string;
	familyId: string | null;
	payload: unknown;
};

export type ClassReachStore = {
	claimHour(now: Date): Promise<boolean>;
	loadSession(): Promise<{ cookies: ClassReachCookie[]; expiresAt: string | null } | null>;
	saveSession(session: { cookies: ClassReachCookie[]; expiresAt: string }): Promise<void>;
	matchFamily(email: string): Promise<string | null>;
	upsertEvents(rows: StagedEvent[]): Promise<number>;
	upsertPeople(rows: StagedPerson[]): Promise<number>;
	recordRun(run: { status: 'ok' | 'failed'; detail: string; events: number; people: number }): Promise<void>;
	alertStatus(): Promise<'ok' | 'failing' | null>;
	saveAlert(status: 'ok' | 'failing', reason: string): Promise<void>;
};

export type SyncResult = { skipped: boolean; reason?: string; events: number; people: number };

type DirectoryUser = {
	UserID?: string | number;
	FullName?: string;
	Email?: string;
	StudentAcademicLevel?: string;
	TaughtCourses?: unknown[];
	DepartmentNames?: unknown[];
	DepartmentCourses?: unknown[];
};

export function assertReadOnly(method: string, rawUrl: string, origin: string): void {
	const url = new URL(rawUrl, origin);
	if (url.origin !== new URL(origin).origin) throw new Error('ClassReach request blocked: off-origin');
	const verb = method.toUpperCase();
	if (verb === 'POST' && url.pathname === '/Login') {
		const back = url.searchParams.get('returnUrl') ?? url.searchParams.get('ReturnUrl');
		if (back === '/') return;
	}
	if (verb === 'POST' && url.pathname === '/UserSession/SelectRole') return;
	if (verb === 'GET' && GET_PATHS.has(url.pathname)) return;
	throw new Error(`ClassReach request blocked: ${verb} ${url.pathname}`);
}

export function classifyDirectoryUser(
	directory: { IsFamilyDirectory?: boolean },
	user: DirectoryUser,
): PersonKind | 'skip' {
	if (String(user.StudentAcademicLevel ?? '').trim()) return 'student';
	const staff =
		(user.TaughtCourses?.length ?? 0) > 0 ||
		(user.DepartmentNames?.length ?? 0) > 0 ||
		(user.DepartmentCourses?.length ?? 0) > 0;
	if (staff) return 'skip';
	if (directory.IsFamilyDirectory) return 'guardian';
	return 'family';
}

export function chicagoDate(now: Date): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(iso: string, days: number): string {
	const [year, month, day] = iso.split('-').map(Number);
	return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The login form's token is the first one on the page. A later file-upload form has a second token. */
export function parseLoginToken(html: string): string {
	const inputs = html.match(/<input\b[^>]*>/gi) ?? [];
	for (const input of inputs) {
		if (!/\bname\s*=\s*["']__RequestVerificationToken["']/i.test(input)) continue;
		const value = input.match(/\bvalue\s*=\s*["']([^"']*)["']/i);
		if (value) return value[1];
	}
	throw new Error('ClassReach login failed');
}

function attr(tag: string, name: string): string {
	const quoted = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
	if (quoted) return quoted[1];
	const bare = tag.match(new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, 'i'));
	return bare ? bare[1] : '';
}

/** Each role is its own form. The Admin post must use that form's token, not the Guardian form's. */
export function parseSelectRole(html: string): { roles: string[]; admin: { method: 'POST'; path: string; body: string } | null } {
	const roles: string[] = [];
	let admin: { method: 'POST'; path: string; body: string } | null = null;
	for (const form of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
		const action = attr(form[1], 'action') || '/UserSession/SelectRole';
		if (!/\/UserSession\/SelectRole/i.test(action)) continue;
		const fields = new Map<string, string>();
		for (const tag of form[2].matchAll(/<input\b[^>]*>/gi)) {
			const name = attr(tag[0], 'name');
			if (name && !fields.has(name)) fields.set(name, attr(tag[0], 'value'));
		}
		const roleName = fields.get('roleName') || '';
		if (roleName && !roles.includes(roleName)) roles.push(roleName);
		if (roleName.toLowerCase() !== 'admin' || admin) continue;
		const params = new URLSearchParams();
		params.set('roleName', roleName);
		params.set('redirectUrl', fields.get('redirectUrl') || '/');
		const token = fields.get('__RequestVerificationToken') || '';
		if (token) params.set('__RequestVerificationToken', token);
		const path = new URL(action, 'https://classreach.local');
		admin = { method: 'POST', path: `${path.pathname}${path.search}`, body: params.toString() };
	}
	return { roles, admin };
}

export function responseIsHtml(contentType: string, body: string): boolean {
	if (/application\/json|text\/javascript/i.test(contentType)) return false;
	if (/text\/html/i.test(contentType)) return true;
	const start = body.trim().slice(0, 80).toLowerCase();
	return start.startsWith('<!doctype') || start.startsWith('<html') || start.startsWith('<head');
}

function pathOf(url: string): string {
	try {
		const parsed = new URL(url);
		return `${parsed.pathname}${parsed.search}`;
	} catch {
		return url;
	}
}

export function htmlTitle(html: string): string {
	const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	return match ? match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) : '';
}

export function loginValidationText(html: string): string {
	const chunks: string[] = [];
	const pattern = /class\s*=\s*["'][^"']*(?:validation-error|field-validation-error|validation-summary-errors)[^"']*["'][^>]*>([\s\S]*?)<\//gi;
	for (const match of html.matchAll(pattern)) {
		const text = match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
		if (text) chunks.push(text);
	}
	return chunks.join(' ').slice(0, 200);
}

function absorbCookies(jar: Map<string, string>, setCookies: string[], now: Date): Date | null {
	let earliest: Date | null = null;
	for (const raw of setCookies) {
		const pair = raw.split(';', 1)[0] ?? '';
		const eq = pair.indexOf('=');
		if (eq <= 0) continue;
		jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
		const maxAge = raw.match(/max-age=(\d+)/i);
		let expires: Date | null = null;
		if (maxAge) expires = new Date(now.getTime() + Number(maxAge[1]) * 1000);
		else {
			const expiresMatch = raw.match(/expires=([^;]+)/i);
			if (expiresMatch) {
				const parsed = new Date(expiresMatch[1].trim());
				if (!Number.isNaN(parsed.getTime())) expires = parsed;
			}
		}
		if (expires && (!earliest || expires < earliest)) earliest = expires;
	}
	return earliest;
}

type PullResult = { events: StagedEvent[]; people: StagedPerson[] };

export async function syncClassReach(input: {
	env: Record<string, string | undefined>;
	fetch: ClassReachFetch;
	sleep: (ms: number) => Promise<void>;
	store: ClassReachStore;
	now?: Date;
	random?: () => number;
	jitterMs?: number;
	timeoutMs?: number;
}): Promise<SyncResult> {
	const username = input.env.CLASSREACH_USERNAME ?? '';
	const password = input.env.CLASSREACH_PASSWORD ?? '';
	if (!username || !password) {
		logClassReach('info', 'classreach_sync_skipped', { reason: 'credentials-unset', events: 0, people: 0 });
		return { skipped: true, reason: 'credentials-unset', events: 0, people: 0 };
	}
	const now = input.now ?? new Date();
	if (!(await input.store.claimHour(now))) {
		logClassReach('info', 'classreach_sync_skipped', { reason: 'hourly-limit', events: 0, people: 0 });
		return { skipped: true, reason: 'hourly-limit', events: 0, people: 0 };
	}
	const jitterMs = input.jitterMs ?? 90_000;
	if (jitterMs > 0) await input.sleep(Math.floor((input.random ?? Math.random)() * jitterMs));
	const origin = (input.env.CLASSREACH_BASE_URL || CLASSREACH_ORIGIN).replace(/\/$/, '');
	const client = new ClassReachClient(origin, input.fetch, input.sleep, now, input.timeoutMs ?? CLASSREACH_FETCH_TIMEOUT_MS);
	try {
		const restored = await client.restore(await input.store.loadSession());
		if (!restored) await client.login(username, password);
		let pulled: PullResult;
		try {
			pulled = await client.pull(now);
		} catch (error) {
			if (!restored) throw error;
			await client.login(username, password);
			pulled = await client.pull(now);
		}
		await input.store.saveSession(client.session(now));
		const matches = new Map<string, string | null>();
		for (const person of pulled.people) {
			const email = person.email.trim().toLowerCase();
			if (!email) continue;
			if (!matches.has(email)) matches.set(email, await input.store.matchFamily(email));
			person.familyId = matches.get(email) ?? null;
		}
		const events = await input.store.upsertEvents(pulled.events);
		const people = await input.store.upsertPeople(pulled.people);
		await input.store.recordRun({ status: 'ok', detail: '', events, people });
		logClassReach('info', 'classreach_sync', { events, people });
		return { skipped: false, events, people };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'ClassReach sync failed';
		try {
			await input.store.recordRun({ status: 'failed', detail: message.slice(0, 500), events: 0, people: 0 });
		} catch {
			/* The hour lock already stops a retry storm. Keep the original error. */
		}
		throw error;
	}
}

/** Read-only pull for a machine outside Netlify. Staging and alerts happen in the portal ingest. */
export async function pullClassReach(input: {
	env: Record<string, string | undefined>;
	fetch: ClassReachFetch;
	sleep: (ms: number) => Promise<void>;
	session?: { cookies: ClassReachCookie[]; expiresAt: string | null } | null;
	now?: Date;
	jitterMs?: number;
	timeoutMs?: number;
}): Promise<{ events: StagedEvent[]; people: StagedPerson[]; session: { cookies: ClassReachCookie[]; expiresAt: string } }> {
	const username = input.env.CLASSREACH_USERNAME ?? '';
	const password = input.env.CLASSREACH_PASSWORD ?? '';
	if (!username || !password) throw new Error('ClassReach credentials are not set');
	const now = input.now ?? new Date();
	if ((input.jitterMs ?? 0) > 0) await input.sleep(Math.floor(Math.random() * (input.jitterMs ?? 0)));
	const origin = (input.env.CLASSREACH_BASE_URL || CLASSREACH_ORIGIN).replace(/\/$/, '');
	const client = new ClassReachClient(origin, input.fetch, input.sleep, now, input.timeoutMs ?? CLASSREACH_FETCH_TIMEOUT_MS);
	const restored = await client.restore(input.session ?? null);
	if (!restored) await client.login(username, password);
	let pulled: PullResult;
	try {
		pulled = await client.pull(now);
	} catch (error) {
		if (!restored) throw error;
		await client.login(username, password);
		pulled = await client.pull(now);
	}
	return {
		events: pulled.events,
		people: pulled.people.map((person) => ({ ...person, familyId: null })),
		session: client.session(now),
	};
}

export async function applyClassReachIngest(input: {
	body: unknown;
	now?: Date;
	store: ClassReachStore;
	notify: (subject: string, text: string) => Promise<void>;
}): Promise<{ status: number; body: Record<string, unknown> }> {
	const normalized = normalizeIngestBody(input.body);
	if (!normalized) return { status: 400, body: { ok: false, error: 'invalid-body' } };
	const now = input.now ?? new Date();
	if (!(await input.store.claimHour(now))) return { status: 429, body: { ok: false, reason: 'hourly-limit' } };
	try {
		const matches = new Map<string, string | null>();
		for (const person of normalized.people) {
			if (!person.email || matches.has(person.email)) continue;
			matches.set(person.email, await input.store.matchFamily(person.email));
		}
		for (const person of normalized.people) person.familyId = person.email ? (matches.get(person.email) ?? null) : null;
		const events = await input.store.upsertEvents(normalized.events);
		const people = await input.store.upsertPeople(normalized.people);
		await input.store.recordRun({ status: 'ok', detail: 'ingest', events, people });
		const previous = await input.store.alertStatus();
		const action = classReachAlertAction(previous, true);
		await input.store.saveAlert('ok', '');
		if (action === 'recovered') await input.notify('ClassReach sync recovered', 'The ClassReach sync succeeded after a failure.');
		logClassReach('info', 'classreach_sync', { events, people, source: 'ingest' });
		return { status: 200, body: { ok: true, events, people } };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'ClassReach ingest failed';
		logClassReach('error', 'classreach_sync_failed', { message, events: 0, people: 0, source: 'ingest' });
		try {
			await input.store.recordRun({ status: 'failed', detail: message.slice(0, 500), events: 0, people: 0 });
			const previous = await input.store.alertStatus();
			const action = classReachAlertAction(previous, false);
			await input.store.saveAlert('failing', message.slice(0, 500));
			if (action === 'fail') await input.notify('ClassReach sync failed', message);
		} catch {
			/* Keep the original ingest error. */
		}
		return { status: 500, body: { ok: false } };
	}
}

class ClassReachClient {
	private jar = new Map<string, string>();
	private sent = false;
	private cookieExpiry: Date | null = null;
	private origin: string;
	private fetch: ClassReachFetch;
	private sleep: (ms: number) => Promise<void>;
	private now: Date;
	private timeoutMs: number;

	constructor(origin: string, fetchImpl: ClassReachFetch, sleep: (ms: number) => Promise<void>, now: Date, timeoutMs: number) {
		this.origin = origin;
		this.fetch = fetchImpl;
		this.sleep = sleep;
		this.now = now;
		this.timeoutMs = timeoutMs;
	}

	async restore(session: { cookies: ClassReachCookie[]; expiresAt: string | null } | null): Promise<boolean> {
		if (!session || session.cookies.length === 0 || !session.expiresAt) return false;
		if (new Date(session.expiresAt).getTime() <= this.now.getTime()) return false;
		for (const cookie of session.cookies) this.jar.set(cookie.name, cookie.value);
		this.cookieExpiry = new Date(session.expiresAt);
		return true;
	}

	session(now: Date): { cookies: ClassReachCookie[]; expiresAt: string } {
		const expires = this.cookieExpiry ?? new Date(now.getTime() + SESSION_MS);
		return {
			cookies: [...this.jar].map(([name, value]) => ({ name, value })),
			expiresAt: expires.toISOString(),
		};
	}

	private hasSharedCookie(): boolean {
		for (const name of this.jar.keys()) {
			if (name.startsWith('.AspNet.SharedCookie')) return true;
		}
		return false;
	}

	private rejectLogin(status: number, url: string, html: string, roles: string[] = []): never {
		let finalUrl = url;
		try {
			const parsed = new URL(url);
			finalUrl = `${parsed.pathname}${parsed.search}`;
		} catch {
			/* Keep the raw URL when it is not absolute. */
		}
		logClassReach('info', 'login_failed', {
			status,
			finalUrl,
			sharedCookie: this.hasSharedCookie(),
			currentRole: this.jar.has('currentRole'),
			roles,
			validation: loginValidationText(html),
		});
		throw new Error('ClassReach login failed');
	}

	private isRolePage(page: { url: string; body: string }): boolean {
		try {
			if (new URL(page.url).pathname === '/UserSession/SelectRole') return true;
		} catch {
			/* A relative URL still counts when the title is the role picker. */
		}
		return htmlTitle(page.body) === 'ChooseRole';
	}

	private isAdminLanding(url: string): boolean {
		try {
			const path = new URL(url).pathname;
			if (path === '/Login' || path === '/UserSession/SelectRole') return false;
			return path === '/Admin' || path.startsWith('/Admin/');
		} catch {
			return false;
		}
	}

	private async finishAdminRole(page: { status: number; url: string; body: string }): Promise<{ status: number; url: string; body: string; contentType: string }> {
		const choice = parseSelectRole(page.body);
		if (!choice.admin) this.rejectLogin(page.status, page.url, page.body, choice.roles);
		const chosen = await this.request('POST', choice.admin.path, choice.admin.body, 6, `${this.origin}/UserSession/SelectRole`);
		if (this.isAdminLanding(chosen.url) && chosen.status === 200) return chosen;
		await this.request('GET', '/');
		const school = await this.request('GET', '/Admin/School');
		if (this.isAdminLanding(school.url) && school.status === 200) return school;
		this.rejectLogin(school.status, school.url, school.body, choice.roles);
	}

	async login(username: string, password: string): Promise<void> {
		try {
			const page = await this.request('GET', '/Login?ReturnUrl=%2F');
			if (page.status !== 200) this.rejectLogin(page.status, page.url, page.body);
			const token = parseLoginToken(page.body);
			const body = new URLSearchParams({
				Username: username,
				Password: password,
				__RequestVerificationToken: token,
			}).toString();
			let done = await this.request('POST', '/Login?returnUrl=%2F', body);
			if (this.isRolePage(done)) done = await this.finishAdminRole(done);
			const landed = new URL(done.url);
			if (!this.isAdminLanding(done.url) || done.status !== 200) this.rejectLogin(done.status, done.url, done.body, parseSelectRole(done.body).roles);
			logClassReach('info', 'login_ok', { status: done.status, finalUrl: `${landed.pathname}${landed.search}` });
		} catch (error) {
			const message = error instanceof Error ? error.message : 'ClassReach login failed';
			if (!/login failed|blocked by Cloudflare/.test(message)) {
				logClassReach('info', 'login_failed', { status: 0, finalUrl: '', sharedCookie: this.hasSharedCookie(), currentRole: this.jar.has('currentRole'), roles: [], validation: message.slice(0, 200) });
			}
			throw error;
		}
	}

	async pull(now: Date): Promise<PullResult> {
		const start = chicagoDate(now);
		const end = addDays(start, 120);
		const calendar = await this.request('GET', `/Calendar/events?startDate=${start}&endDate=${end}`);
		const calendarData = this.readJson('calendar', calendar) as { CalendarEvents?: Array<Record<string, unknown>> };
		const events = stageEvents(calendarData);
		const calendarLog = { status: calendar.status, events: events.length, finalUrl: pathOf(calendar.url) };
		if (events.length === 0) logClassReach('warn', 'calendar', calendarLog);
		else logClassReach('info', 'calendar', calendarLog);
		const directoryPage = await this.request('GET', '/Directory');
		this.rejectRolePicker('directory', directoryPage);
		const info = await this.request('GET', '/Directory/GetDirectoryInfo');
		if (info.status !== 200) {
			logClassReach('info', 'directory', { status: info.status, people: 0, finalUrl: pathOf(info.url) });
			throw new Error(`ClassReach GET /Directory/GetDirectoryInfo returned ${info.status}`);
		}
		const people = await this.directoryPeople(this.readJson('directory', info) as { Directories?: Array<Record<string, unknown>> });
		logClassReach('info', 'directory', { status: 200, people: people.length, finalUrl: pathOf(info.url) });
		return { events, people };
	}

	private rejectRolePicker(step: string, page: { status: number; url: string; body: string }): void {
		if (!this.isRolePage(page)) return;
		logClassReach('info', 'role_not_selected', { step, status: page.status, finalUrl: pathOf(page.url), title: htmlTitle(page.body) });
		throw new Error('ClassReach role not selected');
	}

	private readJson(step: string, page: { status: number; url: string; body: string; contentType: string }): unknown {
		this.rejectRolePicker(step, page);
		if (responseIsHtml(page.contentType, page.body) || page.status !== 200) {
			logClassReach('info', 'unexpected_html', { step, status: page.status, finalUrl: pathOf(page.url), title: htmlTitle(page.body) });
			throw new Error(`ClassReach ${step} returned HTML`);
		}
		try {
			return JSON.parse(page.body);
		} catch {
			logClassReach('info', 'unexpected_html', { step, status: page.status, finalUrl: pathOf(page.url), title: htmlTitle(page.body) });
			throw new Error(`ClassReach ${step} returned HTML`);
		}
	}

	private async directoryPeople(info: { Directories?: Array<Record<string, unknown>> }): Promise<StagedPerson[]> {
		const people: StagedPerson[] = [];
		const seenFamilies = new Set<string>();
		for (const directory of info.Directories ?? []) {
			const directoryId = String(directory.ID ?? '');
			const directoryName = String(directory.Name ?? '');
			let path = `/Directory/GetDirectoryUserInfo?DirectoryId=${encodeURIComponent(directoryId)}&SortProperty=&AscendingOrder=false&SchoolYearId=`;
			for (let page = 0; page < 20; page++) {
				const response = await this.request('GET', path);
				if (response.status !== 200) {
					logClassReach('info', 'directory', { status: response.status, people: people.length });
					throw new Error(`ClassReach GET /Directory/GetDirectoryUserInfo returned ${response.status}`);
				}
				const data = this.readJson('directory', response) as {
					UserList?: DirectoryUser[];
					PagingInfo?: { CurrentPage?: number; TotalPages?: number; URLs?: string[] };
				};
				for (const user of data.UserList ?? []) {
					const kind = classifyDirectoryUser({ IsFamilyDirectory: directory.IsFamilyDirectory === true }, user);
					if (kind === 'skip') continue;
					const email = String(user.Email ?? '').trim().toLowerCase();
					const staged: StagedPerson = {
						classreachId: String(user.UserID ?? ''),
						kind,
						directoryId,
						directoryName,
						email,
						fullName: String(user.FullName ?? ''),
						familyId: null,
						payload: user,
					};
					if (!staged.classreachId) throw new Error('ClassReach directory user is missing UserID');
					people.push(staged);
					if (kind === 'guardian' && email && !seenFamilies.has(email)) {
						seenFamilies.add(email);
						people.push({ ...staged, kind: 'family', classreachId: `email:${email}` });
					}
				}
				const paging = data.PagingInfo;
				if (!paging || (paging.CurrentPage ?? 1) >= (paging.TotalPages ?? 1)) break;
				const linked = (paging.URLs ?? [])
					.map((value) => {
						try {
							return new URL(value, this.origin);
						} catch {
							return null;
						}
					})
					.find((url) => url?.pathname === '/Directory/GetDirectoryUserInfo');
				if (linked) path = `${linked.pathname}${linked.search}`;
				else {
					const next = new URL(path, this.origin);
					next.searchParams.set('Page', String((paging.CurrentPage ?? 1) + 1));
					path = `${next.pathname}${next.search}`;
				}
			}
		}
		return people;
	}

	private async request(method: 'GET' | 'POST', path: string, body?: string, redirectsLeft = 6, referer?: string): Promise<{ status: number; url: string; body: string; contentType: string }> {
		const url = new URL(path, this.origin);
		assertReadOnly(method, url.toString(), this.origin);
		const response = await this.send(method, url, body, referer);
		if ([301, 302, 303, 307, 308].includes(response.status)) {
			const location = response.headers.get('location');
			if (!location) throw new Error(`ClassReach ${method} ${url.pathname} returned ${response.status}`);
			if (redirectsLeft <= 0) throw new Error('ClassReach redirect limit');
			const next = new URL(location, url);
			return this.request('GET', `${next.pathname}${next.search}`, undefined, redirectsLeft - 1);
		}
		const effective = response.headers.get('x-classreach-url');
		return {
			status: response.status,
			url: effective || url.toString(),
			body: await response.text(),
			contentType: response.headers.get('content-type') || '',
		};
	}

	private async send(method: 'GET' | 'POST', url: URL, body?: string, referer?: string): Promise<ClassReachResponse> {
		for (let attempt = 1; attempt <= 2; attempt++) {
			if (this.sent) await this.sleep(MIN_GAP_MS);
			this.sent = true;
			const xhr = url.pathname.startsWith('/Calendar/') || url.pathname.startsWith('/Directory/');
			const headers: Record<string, string> = {
				'user-agent': USER_AGENT,
				accept: xhr ? 'application/json, text/javascript, */*; q=0.01' : HTML_ACCEPT,
				'accept-language': 'en-US,en;q=0.9',
			};
			if (xhr) {
				headers['x-requested-with'] = 'XMLHttpRequest';
				headers.referer = `${url.origin}${url.pathname.startsWith('/Directory/') ? '/Directory' : '/Calendar'}`;
			}
			if (method === 'POST') {
				headers.origin = url.origin;
				headers.referer = referer || `${url.origin}/Login`;
				headers['content-type'] = 'application/x-www-form-urlencoded';
			}
			if (this.jar.size) headers.cookie = [...this.jar].map(([name, value]) => `${name}=${value}`).join('; ');
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), this.timeoutMs);
			let response: ClassReachResponse;
			try {
				response = await this.fetch(url.toString(), { method, headers, body, redirect: 'manual', signal: controller.signal });
			} catch (error) {
				const name = error instanceof Error ? error.name : '';
				if (controller.signal.aborted || name === 'TimeoutError' || name === 'AbortError') throw new Error(`ClassReach ${method} ${url.pathname} timed out`);
				throw error;
			} finally {
				clearTimeout(timer);
			}
			const expiry = absorbCookies(this.jar, response.headers.getSetCookie(), this.now);
			if (expiry && (!this.cookieExpiry || expiry < this.cookieExpiry)) this.cookieExpiry = expiry;
			if (!this.cookieExpiry) this.cookieExpiry = new Date(this.now.getTime() + SESSION_MS);
			if (response.status === 403) {
				const mitigated = response.headers.get('cf-mitigated');
				const body = mitigated ? '' : await response.text();
				if (cloudflareChallenge(response.status, response.headers, body)) {
					logClassReach('info', 'classreach_blocked', { status: response.status, cfRay: response.headers.get('cf-ray') || '' });
					throw new Error('ClassReach blocked by Cloudflare');
				}
				if (body) response = { ...response, text: async () => body };
			}
			if (response.status !== 403 && response.status !== 429) return response;
			if (attempt === 2) throw new Error(`ClassReach ${method} ${url.pathname} returned ${response.status}`);
			await this.sleep(30_000);
		}
		throw new Error(`ClassReach ${method} ${url.pathname} returned 429`);
	}
}

function stageEvents(payload: { CalendarEvents?: Array<Record<string, unknown>> }): StagedEvent[] {
	return (payload.CalendarEvents ?? []).map((row) => {
		const event = (row.CalendarEvent ?? row) as Record<string, unknown>;
		const id = event.CalendarEventID ?? event.ID ?? event.Id ?? event.EventID;
		if (id == null || id === '') throw new Error('ClassReach event is missing CalendarEventID');
		const start = String(event.StartDate ?? event.Start ?? '');
		const end = String(event.EndDate ?? event.End ?? '');
		return {
			classreachId: String(id),
			title: String(event.Title ?? event.Name ?? ''),
			startsOn: start.slice(0, 10),
			endsOn: end.slice(0, 10),
			payload: row,
		};
	});
}
