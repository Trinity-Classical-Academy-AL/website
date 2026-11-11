/** Read-only ClassReach client. Login is the only POST. Everything else is an allowlisted GET. */

export const CLASSREACH_ORIGIN = 'https://trinityclassicalacademy.classreach.com';
export const MIN_GAP_MS = 1500;
export const HOUR_MS = 60 * 60 * 1000;
const SESSION_MS = 8 * 60 * 60 * 1000;
const USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const GET_PATHS = new Set([
	'/Login',
	'/UserSession/SelectRole',
	'/',
	'/Admin/School',
	'/Calendar/events',
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
	init: { method: string; headers: Record<string, string>; body?: string; redirect: 'manual' },
) => Promise<ClassReachResponse>;

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

function parseToken(html: string): string {
	const patterns = [
		/name="__RequestVerificationToken"[^>]*value="([^"]+)"/,
		/value="([^"]+)"[^>]*name="__RequestVerificationToken"/,
	];
	for (const pattern of patterns) {
		const match = html.match(pattern);
		if (match) return match[1];
	}
	throw new Error('ClassReach login failed');
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
}): Promise<SyncResult> {
	const username = input.env.CLASSREACH_USERNAME ?? '';
	const password = input.env.CLASSREACH_PASSWORD ?? '';
	if (!username || !password) return { skipped: true, reason: 'credentials-unset', events: 0, people: 0 };
	const now = input.now ?? new Date();
	if (!(await input.store.claimHour(now))) return { skipped: true, reason: 'hourly-limit', events: 0, people: 0 };
	const jitterMs = input.jitterMs ?? 90_000;
	if (jitterMs > 0) await input.sleep(Math.floor((input.random ?? Math.random)() * jitterMs));
	const origin = (input.env.CLASSREACH_BASE_URL || CLASSREACH_ORIGIN).replace(/\/$/, '');
	const client = new ClassReachClient(origin, input.fetch, input.sleep, now);
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

class ClassReachClient {
	private jar = new Map<string, string>();
	private sent = false;
	private cookieExpiry: Date | null = null;
	private origin: string;
	private fetch: ClassReachFetch;
	private sleep: (ms: number) => Promise<void>;
	private now: Date;

	constructor(origin: string, fetchImpl: ClassReachFetch, sleep: (ms: number) => Promise<void>, now: Date) {
		this.origin = origin;
		this.fetch = fetchImpl;
		this.sleep = sleep;
		this.now = now;
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

	async login(username: string, password: string): Promise<void> {
		const page = await this.request('GET', '/Login?ReturnUrl=%2F');
		if (page.status !== 200) throw new Error(`ClassReach GET /Login returned ${page.status}`);
		const token = parseToken(page.body);
		const body = new URLSearchParams({
			Username: username,
			Password: password,
			__RequestVerificationToken: token,
		}).toString();
		const done = await this.request('POST', '/Login?returnUrl=%2F', body);
		const landed = new URL(done.url);
		if (landed.pathname !== '/Admin/School' || done.status !== 200) throw new Error('ClassReach login failed');
	}

	async pull(now: Date): Promise<PullResult> {
		const start = chicagoDate(now);
		const end = addDays(start, 120);
		const calendar = await this.request('GET', `/Calendar/events?startDate=${start}&endDate=${end}`);
		if (new URL(calendar.url).pathname === '/Login') throw new Error('ClassReach session expired');
		if (calendar.status !== 200) throw new Error(`ClassReach GET /Calendar/events returned ${calendar.status}`);
		const events = stageEvents(JSON.parse(calendar.body) as { CalendarEvents?: Array<Record<string, unknown>> });
		const info = await this.request('GET', '/Directory/GetDirectoryInfo');
		if (info.status !== 200) throw new Error(`ClassReach GET /Directory/GetDirectoryInfo returned ${info.status}`);
		const people = await this.directoryPeople(JSON.parse(info.body) as { Directories?: Array<Record<string, unknown>> });
		return { events, people };
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
				if (response.status !== 200) throw new Error(`ClassReach GET /Directory/GetDirectoryUserInfo returned ${response.status}`);
				const data = JSON.parse(response.body) as {
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

	private async request(method: 'GET' | 'POST', path: string, body?: string, redirectsLeft = 6): Promise<{ status: number; url: string; body: string }> {
		const url = new URL(path, this.origin);
		assertReadOnly(method, url.toString(), this.origin);
		const response = await this.send(method, url, body);
		if ([301, 302, 303, 307, 308].includes(response.status)) {
			const location = response.headers.get('location');
			if (!location) throw new Error(`ClassReach ${method} ${url.pathname} returned ${response.status}`);
			if (redirectsLeft <= 0) throw new Error('ClassReach redirect limit');
			const next = new URL(location, url);
			return this.request('GET', `${next.pathname}${next.search}`, undefined, redirectsLeft - 1);
		}
		return { status: response.status, url: url.toString(), body: await response.text() };
	}

	private async send(method: 'GET' | 'POST', url: URL, body?: string): Promise<ClassReachResponse> {
		for (let attempt = 1; attempt <= 3; attempt++) {
			if (this.sent) await this.sleep(MIN_GAP_MS);
			this.sent = true;
			const headers: Record<string, string> = {
				'user-agent': USER_AGENT,
				accept: method === 'GET' && (url.pathname.startsWith('/Calendar/') || url.pathname.startsWith('/Directory/')) ? 'application/json' : 'text/html',
			};
			if (url.pathname.startsWith('/Calendar/') || url.pathname.startsWith('/Directory/')) headers['x-requested-with'] = 'XMLHttpRequest';
			if (body) headers['content-type'] = 'application/x-www-form-urlencoded';
			if (this.jar.size) headers.cookie = [...this.jar].map(([name, value]) => `${name}=${value}`).join('; ');
			const response = await this.fetch(url.toString(), { method, headers, body, redirect: 'manual' });
			const expiry = absorbCookies(this.jar, response.headers.getSetCookie(), this.now);
			if (expiry && (!this.cookieExpiry || expiry < this.cookieExpiry)) this.cookieExpiry = expiry;
			if (!this.cookieExpiry) this.cookieExpiry = new Date(this.now.getTime() + SESSION_MS);
			if (response.status !== 403 && response.status !== 429) return response;
			if (attempt === 3) throw new Error(`ClassReach ${method} ${url.pathname} returned ${response.status}`);
			await this.sleep(30_000 * attempt);
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
