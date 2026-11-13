import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
	addDays,
	assertReadOnly,
	chicagoDate,
	classifyDirectoryUser,
	readClassReachEnv,
	syncClassReach,
} from '../packages/school/src/classreach.ts';

const ORIGIN = 'https://classreach.test';
const NOW = new Date('2026-11-11T18:00:00Z');
const LOGIN_HTML = `<form method="post" action="/Login?returnUrl=%2F"><input name="__RequestVerificationToken" type="hidden" value="token-abc" /></form>`;

const source = readFileSync(new URL('../packages/school/src/classreach.ts', import.meta.url), 'utf8');
const storeSource = readFileSync(new URL('../packages/school/src/classreach-db.ts', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../packages/school/src/schema.ts', import.meta.url), 'utf8');

function response(status, body, { location, cookies = [] } = {}) {
	return {
		status,
		headers: {
			get(name) {
				return name.toLowerCase() === 'location' ? (location ?? null) : null;
			},
			getSetCookie() {
				return cookies;
			},
		},
		async text() {
			return typeof body === 'string' ? body : JSON.stringify(body);
		},
	};
}

function memoryStore(options = {}) {
	const state = {
		runs: [],
		events: [],
		people: [],
		session: options.session ?? null,
		claimed: false,
		matched: [],
	};
	return {
		state,
		async claimHour() {
			if (options.claim === false) return false;
			if (state.claimed) return false;
			state.claimed = true;
			return true;
		},
		async loadSession() {
			return state.session;
		},
		async saveSession(session) {
			state.session = session;
		},
		async matchFamily(email) {
			state.matched.push(email);
			return email === 'ada@example.com' ? 'family-ada' : null;
		},
		async upsertEvents(rows) {
			state.events.push(...rows);
			return rows.length;
		},
		async upsertPeople(rows) {
			state.people.push(...rows);
			return rows.length;
		},
		async recordRun(run) {
			state.runs.push(run);
		},
	};
}

function site(options = {}) {
	const calls = [];
	const sleeps = [];
	let calendarTries = 0;
	let directoryPages = 0;
	const fetch = async (url, init) => {
		calls.push({ url, method: init.method, headers: init.headers, body: init.body ?? '' });
		const path = new URL(url).pathname;
		const page = new URL(url).searchParams.get('Page');
		const directoryId = new URL(url).searchParams.get('DirectoryId');
		if (path === '/Login' && init.method === 'GET') {
			return response(200, LOGIN_HTML, { cookies: ['.AspNet.SharedCookie=session; HttpOnly; Path=/'] });
		}
		if (path === '/Login' && init.method === 'POST') {
			if (options.badPassword) return response(200, LOGIN_HTML);
			return response(302, '', { location: '/UserSession/SelectRole' });
		}
		if (path === '/UserSession/SelectRole') return response(302, '', { location: '/' });
		if (path === '/') return response(302, '', { location: '/Admin/School' });
		if (path === '/Admin/School') return response(200, 'school');
		if (path === '/Calendar/events') {
			calendarTries += 1;
			if (options.calendar429 && calendarTries === 1) return response(429, '');
			if (options.expireSession && calendarTries === 1) return response(302, '', { location: '/Login?ReturnUrl=%2F' });
			return response(200, {
				CalendarEvents: [
					{
						CalendarEvent: {
							CalendarEventID: 501,
							Title: 'New Family Info Night',
							StartDate: '2027-01-21T19:00:00',
							EndDate: '2027-01-21T20:30:00',
						},
						IsEventEditable: false,
					},
				],
			});
		}
		if (path === '/Directory/GetDirectoryInfo') {
			return response(200, {
				Directories: [
					{ SortOrder: 1, ID: 10, Name: 'Families', IsFamilyDirectory: true },
					{ SortOrder: 2, ID: 11, Name: 'Students', IsFamilyDirectory: false },
				],
			});
		}
		if (path === '/Directory/GetDirectoryUserInfo') {
			directoryPages += 1;
			if (directoryId === '11') {
				return response(200, {
					DirectoryId: 11,
					Name: 'Students',
					SchoolName: 'Trinity Classical Academy',
					SchoolYearId: 4,
					DirectoryFieldDisplay: [],
					ShowEmail: false,
					ShowMobilePhone: false,
					UserList: [
						{
							UserID: 'student-noah',
							FullName: 'Noah Brock',
							Email: '',
							MobilePhone: '',
							FieldDisplay: [],
							TaughtCourses: [],
							DepartmentNames: [],
							DepartmentCourses: [],
							StudentAcademicLevel: '3rd',
						},
						{
							UserID: 'teacher-1',
							FullName: 'Latin Teacher',
							Email: 'latin@example.com',
							TaughtCourses: ['Latin'],
							DepartmentNames: [],
							DepartmentCourses: [],
							StudentAcademicLevel: '',
						},
					],
					PagingInfo: { TotalItems: 2, ItemsPerPage: 50, CurrentPage: 1, TotalPages: 1, URLs: [] },
				});
			}
			const current = page === '2' ? 2 : 1;
			const user = current === 1
				? { UserID: 'guardian-ada', FullName: 'Ada Lovelace', Email: 'Ada@Example.com', StudentAcademicLevel: '' }
				: { UserID: 'guardian-bea', FullName: 'Bea Lovelace', Email: 'bea@example.com', StudentAcademicLevel: '' };
			return response(200, {
				DirectoryId: 10,
				Name: 'Families',
				SchoolName: 'Trinity Classical Academy',
				SchoolYearId: 4,
				DirectoryFieldDisplay: [{ DirectoryField_ID: 1, OrderNumber: 1, PropertyID: 2, ColumnName: 'Students' }],
				ShowEmail: true,
				ShowMobilePhone: false,
				UserList: [{ ...user, MobilePhone: '', FieldDisplay: [], TaughtCourses: [], DepartmentNames: [], DepartmentCourses: [] }],
				PagingInfo: { TotalItems: 2, ItemsPerPage: 1, CurrentPage: current, TotalPages: 2, URLs: [] },
			});
		}
		throw new Error(`unexpected ${init.method} ${url}`);
	};
	return { calls, sleeps, fetch, get directoryPages() { return directoryPages; } };
}

function env() {
	return { CLASSREACH_USERNAME: 'bryantbrock', CLASSREACH_PASSWORD: 'secret-value', CLASSREACH_BASE_URL: ORIGIN };
}

async function run(fake, store, extra = {}) {
	return syncClassReach({
		env: env(),
		fetch: fake.fetch,
		sleep: async (ms) => {
			fake.sleeps.push(ms);
		},
		store,
		now: NOW,
		jitterMs: 0,
		...extra,
	});
}

test('does nothing until both ClassReach env vars are set', async () => {
	let called = false;
	const store = memoryStore();
	const result = await syncClassReach({
		env: {},
		fetch: async () => {
			called = true;
			throw new Error('network');
		},
		sleep: async () => {},
		store,
		jitterMs: 0,
	});
	assert.equal(result.skipped, true);
	assert.equal(result.reason, 'credentials-unset');
	assert.equal(called, false);
	assert.equal(store.state.claimed, false);
});

test('logs in, reuses the cookie, and stages the next 120 days plus directory pages', async () => {
	const fake = site();
	const store = memoryStore();
	const result = await run(fake, store);
	assert.equal(result.skipped, false);
	assert.equal(result.events, 1);
	assert.equal(store.state.events[0].classreachId, '501');
	assert.equal(store.state.events[0].title, 'New Family Info Night');
	const start = chicagoDate(NOW);
	const calendar = fake.calls.find((call) => call.url.includes('/Calendar/events'));
	assert.ok(calendar.url.includes(`startDate=${start}`));
	assert.ok(calendar.url.includes(`endDate=${addDays(start, 120)}`));
	assert.equal(calendar.headers['x-requested-with'], 'XMLHttpRequest');
	assert.match(calendar.headers['user-agent'], /Chrome/);
	assert.match(calendar.headers.cookie, /\.AspNet\.SharedCookie=session/);
	const post = fake.calls.find((call) => call.method === 'POST');
	assert.match(post.body, /Username=bryantbrock/);
	assert.match(post.body, /__RequestVerificationToken=token-abc/);
	assert.match(post.body, /Password=secret-value/);
	assert.equal(post.headers['content-type'], 'application/x-www-form-urlencoded');
	assert.match(post.headers.cookie, /\.AspNet\.SharedCookie=session/);
	assert.equal(post.headers['x-requested-with'], undefined);
	const guardians = store.state.people.filter((person) => person.kind === 'guardian');
	const families = store.state.people.filter((person) => person.kind === 'family');
	const students = store.state.people.filter((person) => person.kind === 'student');
	assert.deepEqual(guardians.map((person) => person.email), ['ada@example.com', 'bea@example.com']);
	assert.equal(guardians[0].familyId, 'family-ada');
	assert.equal(families[0].classreachId, 'email:ada@example.com');
	assert.equal(families[0].familyId, 'family-ada');
	assert.equal(students.length, 1);
	assert.equal(students[0].fullName, 'Noah Brock');
	assert.equal(store.state.people.some((person) => person.fullName === 'Latin Teacher'), false);
	assert.equal(fake.directoryPages, 3);
	assert.ok(fake.sleeps.every((ms) => ms >= 1500));
	assert.equal(fake.sleeps.length, fake.calls.length - 1);
	assert.equal(store.state.runs[0].status, 'ok');
	assert.equal(store.state.session.cookies[0].name, '.AspNet.SharedCookie');
});

test('reuses a live session and does not log in again', async () => {
	const fake = site();
	const store = memoryStore({
		session: { cookies: [{ name: '.AspNet.SharedCookie', value: 'kept' }], expiresAt: '2026-11-12T00:00:00Z' },
	});
	await run(fake, store);
	assert.equal(fake.calls.some((call) => call.url.includes('/Login')), false);
	assert.match(fake.calls[0].headers.cookie, /\.AspNet\.SharedCookie=kept/);
});

test('backs off on 429 and logs in again when the session is sent back to Login', async () => {
	const limited = site({ calendar429: true });
	const store = memoryStore();
	await run(limited, store);
	assert.ok(limited.sleeps.includes(30_000));
	const expired = site({ expireSession: true });
	const again = memoryStore({
		session: { cookies: [{ name: '.AspNet.SharedCookie', value: 'old' }], expiresAt: '2026-11-12T00:00:00Z' },
	});
	await run(expired, again);
	assert.ok(expired.calls.some((call) => call.method === 'POST' && call.url.includes('/Login')));
	assert.equal(again.state.events[0].classreachId, '501');
});

test('a failed login is recorded without the password, and a second run inside the hour does not call ClassReach', async () => {
	const fake = site({ badPassword: true });
	const store = memoryStore();
	await assert.rejects(run(fake, store), /ClassReach login failed/);
	assert.equal(store.state.runs[0].status, 'failed');
	assert.doesNotMatch(store.state.runs[0].detail, /secret-value/);
	const second = site();
	const blocked = memoryStore({ claim: false });
	const skipped = await run(second, blocked);
	assert.equal(skipped.reason, 'hourly-limit');
	assert.equal(second.calls.length, 0);
});

test('write endpoints and other origins are refused', () => {
	for (const [method, url] of [
		['POST', `${ORIGIN}/Forms/GetForms`],
		['POST', `${ORIGIN}/Messages/GetMessageThreads`],
		['POST', `${ORIGIN}/Reports/GetReportParameters`],
		['GET', `${ORIGIN}/Admin/People`],
		['GET', 'https://evil.example/Calendar/events'],
		['POST', `${ORIGIN}/Login`],
	]) {
		assert.throws(() => assertReadOnly(method, url, ORIGIN), /blocked/);
	}
	assert.doesNotThrow(() => assertReadOnly('POST', `${ORIGIN}/Login?returnUrl=%2F`, ORIGIN));
	assert.doesNotMatch(source, /\/Messages|\/Forms|\/Reports|\/Admin\/People/);
	assert.equal(classifyDirectoryUser({ IsFamilyDirectory: true }, { StudentAcademicLevel: '3rd' }), 'student');
	assert.equal(classifyDirectoryUser({ IsFamilyDirectory: false }, { TaughtCourses: ['Latin'] }), 'skip');
});

test('every sync result is a console.log line and does not include the password', async () => {
	const lines = [];
	const original = console.log;
	console.log = (value) => {
		lines.push(String(value));
	};
	try {
		const skipped = await syncClassReach({
			env: {},
			fetch: async () => {
				throw new Error('network');
			},
			sleep: async () => {},
			store: memoryStore(),
			jitterMs: 0,
		});
		assert.equal(skipped.reason, 'credentials-unset');
		const limited = await syncClassReach({
			env: env(),
			fetch: async () => {
				throw new Error('network');
			},
			sleep: async () => {},
			store: memoryStore({ claim: false }),
			jitterMs: 0,
		});
		assert.equal(limited.reason, 'hourly-limit');
	} finally {
		console.log = original;
	}
	const text = lines.join('\n');
	assert.match(text, /"event":"classreach_sync_skipped"/);
	assert.match(text, /credentials-unset/);
	assert.match(text, /hourly-limit/);
	assert.doesNotMatch(text, /secret-value/);
});

test('credentials are read from the runtime environment', () => {
	const previousUser = process.env.CLASSREACH_USERNAME;
	const previousPass = process.env.CLASSREACH_PASSWORD;
	process.env.CLASSREACH_USERNAME = 'bryantbrock';
	process.env.CLASSREACH_PASSWORD = 'secret-value';
	try {
		const read = readClassReachEnv();
		assert.equal(read.CLASSREACH_USERNAME, 'bryantbrock');
		assert.equal(read.CLASSREACH_PASSWORD, 'secret-value');
	} finally {
		if (previousUser === undefined) delete process.env.CLASSREACH_USERNAME;
		else process.env.CLASSREACH_USERNAME = previousUser;
		if (previousPass === undefined) delete process.env.CLASSREACH_PASSWORD;
		else process.env.CLASSREACH_PASSWORD = previousPass;
	}
	const runSource = readFileSync(new URL('../packages/school/src/classreach-run.ts', import.meta.url), 'utf8');
	const syncSource = readFileSync(new URL('../packages/school/src/classreach.ts', import.meta.url), 'utf8');
	assert.match(syncSource, /env\['CLASSREACH_USERNAME'\]/);
	assert.match(syncSource, /env\['CLASSREACH_PASSWORD'\]/);
	assert.match(syncSource, /console\.log\(line\)/);
	assert.match(runSource, /readClassReachEnv/);
	assert.doesNotMatch(runSource, /console\.info/);
	assert.doesNotMatch(syncSource, /console\.info/);
});

test('staging tables are additive and approval is not overwritten on sync', () => {
	for (const table of ['classreach_events', 'classreach_families', 'classreach_students', 'classreach_guardians', 'classreach_sessions', 'classreach_sync_runs']) {
		assert.match(schema, new RegExp(`create table if not exists ${table}`));
	}
	assert.match(schema, /approval text not null default 'pending'/);
	assert.doesNotMatch(storeSource, /approval = excluded/);
	assert.match(storeSource, /coalesce\(excluded\.family_id/);
	assert.doesNotMatch(schema, /drop table|drop column|rename /i);
});
