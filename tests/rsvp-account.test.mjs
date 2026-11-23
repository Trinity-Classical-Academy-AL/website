import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { safeNext, rememberNext, rememberTour, pendingNext, landingAfterAuth, beginGoogleState, consumeGoogleState } from '../portal/src/lib/security.ts';
import { rsvpReturnNotice } from '../portal/src/lib/rsvp-return.ts';
import { POST as signOut } from '../portal/src/pages/sign-out.ts';

const path = '/rsvp/ec99c6a0-30da-4b66-8ccb-777c05360f4b';
function cookies() {
	const values = new Map();
	const options = new Map();
	return { values, options, get: (key) => values.has(key) ? { value: values.get(key) } : undefined,
		set: (key, value, opts) => { values.set(key, value); options.set(key, opts); }, delete: (key) => values.delete(key) };
}

test('safe return accepts exact RSVP UUID paths and existing tour aliases only', () => {
	for (const value of [path, path.toUpperCase().replace('/RSVP/', '/rsvp/'), '/tour', 'tour']) assert.equal(safeNext(value), value === 'tour' ? '/tour' : value);
	for (const value of [null, undefined, '', '/', '/home', '/admin', '//evil.com', 'https://evil.com', 'https://portal.test' + path, '\\evil.com', '/\\evil.com', path + '\n', path + '\r', path + '/', path + '?next=//evil.com', path + '#x', ' ' + path, path + ' ', '/rsvp/not-a-uuid', '/rsvp/../admin', '/rsvp/%2e%2e/admin', '/%2frsvp/' + path.slice(6), encodeURIComponent(path), '%252f%252fevil.com', path.replace('/rsvp/', '/rsvp%2f'), path + '%00']) assert.equal(safeNext(value), null, String(value));
});

test('RSVP notice looks up only an allowlisted event and has a missing-event fallback', async () => {
	const ids = [];
	const lookup = async id => { ids.push(id); return { title: 'Information & Enrollment Night' }; };
	for (const next of [null, '/tour', '//evil.com', path + '?next=//evil.com', encodeURIComponent(path), '/rsvp/not-an-id']) assert.equal(await rsvpReturnNotice(next, lookup), '');
	assert.deepEqual(ids, []);
	assert.equal(await rsvpReturnNotice(path, lookup), 'Create an account or sign in to RSVP for Information & Enrollment Night.');
	assert.deepEqual(ids, [path.slice(6)]);
	assert.equal(await rsvpReturnNotice(path, async () => null), 'Create an account or sign in to RSVP.');
});

test('sign out safely preserves the RSVP return on the unified sign-on URL', async () => {
	for (const next of [path, '//evil.com', 'https://evil.com', path + '?x=1', '/tour', '']) {
		const jar = cookies();
		jar.set('tca_csrf', 'local-csrf');
		jar.set('tca_family_session', 'local-session');
		rememberNext(jar, true, path);
		const url = new URL('https://portal.test/sign-out');
		const request = new Request(url, { method: 'POST', body: new URLSearchParams({ next, csrf: 'local-csrf' }) });
		const response = await signOut({ url, request, cookies: jar, redirect: (target, status) => new Response(null, { status, headers: { location: target } }) });
		assert.equal(response.status, 303);
		const target = new URL(response.headers.get('location'));
		assert.equal(target.origin, url.origin);
		assert.equal(target.pathname, next === '/tour' ? '/tour' : '/');
		assert.equal(target.searchParams.get('next'), next === path ? path : null);
		assert.equal(pendingNext(jar), next === path ? path : next === '/tour' ? '/tour' : null);
		assert.equal(jar.values.has('tca_family_session'), false);
	}
});

test('return cookie is short-lived, httpOnly, validated again, and consumed once for every role', () => {
	for (const roles of [['guardian'], ['prospect'], ['admin'], ['staff'], []]) {
		const jar = cookies();
		rememberNext(jar, true, path);
		assert.deepEqual(jar.options.get('tca_after_login'), { httpOnly: true, sameSite: 'lax', path: '/', secure: true, maxAge: 3600 });
		rememberNext(jar, true, null);
		assert.equal(landingAfterAuth(jar, roles), path);
		assert.equal(pendingNext(jar), null);
		// Without a remembered page: guardians land on /g, staff on /staff, everyone else /home.
		assert.equal(landingAfterAuth(jar, roles), roles.includes('guardian') ? '/g' : roles.includes('staff') ? '/staff' : '/home');
		rememberNext(jar, true, path);
		rememberNext(jar, true, '//evil.com');
		assert.equal(pendingNext(jar), null);
		jar.set('tca_after_login', 'https://evil.com');
		assert.equal(landingAfterAuth(jar, roles), roles.includes('guardian') ? '/g' : roles.includes('staff') ? '/staff' : '/home');
	}
	const jar = cookies();
	rememberTour(jar, false);
	assert.equal(landingAfterAuth(jar, ['prospect']), '/tour');
	assert.equal(landingAfterAuth(jar, ['prospect']), '/home');
});

test('Google state binds safe return and account linking to a one-time browser nonce', () => {
	const jar = cookies();
	rememberNext(jar, true, path);
	const state = beginGoogleState(jar, true, 'email-to-link');
	assert.ok(state.length >= 32);
	assert.equal(jar.options.get('tca_google_state').httpOnly, true);
	assert.equal(jar.options.get('tca_google_state').maxAge, 600);
	assert.deepEqual(consumeGoogleState(jar, state), { next: path, link: 'email-to-link' });
	assert.equal(consumeGoogleState(jar, state), null);
	beginGoogleState(jar, true);
	assert.equal(consumeGoogleState(jar, 'forged'), null);
	jar.set('tca_google_state', '{invalid');
	assert.equal(consumeGoogleState(jar, state), null);
	jar.set('tca_google_state', JSON.stringify({ nonce: state, next: '//evil.com' }));
	assert.deepEqual(consumeGoogleState(jar, state), { next: null, link: '' });
});

test('account RSVP upserts, notes, limits, closed events, guardian updates, CSV and legacy compatibility', async (t) => {
	if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is not set');
	const { db, dbReady, accountRsvp, saveAccountRsvp, setRsvp, eventRsvps, guestRsvpsCsv, eventRsvpTotals, deleteEvent } = await import('@tca/school');
	await dbReady();
	const event = randomUUID();
	const family = randomUUID();
	const email = `rsvp-${family}@example.com`;
	try {
		await db()`insert into families (id, name, email, password_hash, roles) values (${family}, 'Account Example', ${email}, '', ${['prospect']})`;
		await db()`insert into events (id, title, starts_at, collect_rsvp) values (${event}, 'Account event', now() + interval '1 day', true)`;
		assert.equal(await accountRsvp(event, family), null);
		const input = { eventId: event, familyId: family, headCount: 1, note: ' Hello ' };
		assert.deepEqual(await saveAccountRsvp(input), { ok: true });
		const [first] = await db()`select * from rsvps where event_id = ${event}`;
		assert.equal(first.note, 'Hello');
		await saveAccountRsvp({ ...input, headCount: 20, note: 'Updated' });
		assert.deepEqual({ ...await accountRsvp(event, family) }, { headCount: 20, note: 'Updated' });
		const rows = await db()`select * from rsvps where event_id = ${event}`;
		assert.equal(rows.length, 1);
		assert.equal(rows[0].id, first.id);
		assert.equal(+rows[0].created_at, +first.created_at);
		assert.ok(+rows[0].updated_at >= +first.updated_at);
		for (const change of [{ headCount: 0 }, { headCount: 21 }, { headCount: -1 }, { headCount: 1.5 }, { headCount: NaN }, { headCount: Infinity }, { note: 'x'.repeat(1001) }, { eventId: 'bad' }, { eventId: randomUUID() }, { familyId: 'bad' }, { familyId: randomUUID() }]) assert.equal((await saveAccountRsvp({ ...input, ...change })).ok, false);
		assert.equal((await setRsvp({ eventId: event, familyId: family, headCount: 3, familyName: 'Example', email, eventTitle: 'Account event' })).ok, true);
		assert.equal((await accountRsvp(event, family)).note, 'Updated');
		await saveAccountRsvp({ ...input, note: '' });
		assert.equal((await accountRsvp(event, family)).note, '');
		// Simulate an old build inserting only the original columns.
		await db()`delete from rsvps where event_id = ${event}`;
		await db()`insert into rsvps (id, event_id, family_id, head_count) values (${randomUUID()}, ${event}, ${family}, 2)`;
		assert.equal((await accountRsvp(event, family)).note, '');
		await db()`insert into event_guest_rsvps (id, event_id, name, email, head_count, note) values (${randomUUID()}, ${event}, 'Legacy Example', 'legacy@example.com', 4, 'Legacy note')`;
		const responses = await eventRsvps(event);
		assert.deepEqual(responses.map(r => r.type).sort(), ['account', 'guest (legacy)']);
		const csv = await guestRsvpsCsv(event).then(r => r.text());
		for (const text of [email, 'legacy@example.com', 'guest (legacy)', 'Legacy note', 'Updated']) assert.ok(csv.includes(text), text);
		const total = (await eventRsvpTotals()).find(r => r.id === event);
		assert.equal(total.responses, 2);
		assert.equal(total.heads, 6);
		for (const change of ['collect_rsvp = false', "starts_at = now() - interval '4 hours'", "ends_at = now() - interval '1 minute'"]) {
			await db().unsafe(`update events set collect_rsvp = true, starts_at = now() + interval '1 day', ends_at = null where id = '${event}'`);
			await db().unsafe(`update events set ${change} where id = '${event}'`);
			assert.equal((await saveAccountRsvp(input)).ok, false);
		}
		const output = console.info;
		const messages = [];
		try {
			console.info = (message) => messages.push(String(message));
			await deleteEvent(event);
		} finally { console.info = output; }
		assert.ok(messages.some(message => message.includes(`To: ${email}`) && message.includes('Account event was cancelled')));
		assert.equal((await db()`select count(*)::int as n from rsvps where event_id = ${event}`)[0].n, 0);
		assert.equal((await db()`select count(*)::int as n from event_guest_rsvps where event_id = ${event}`)[0].n, 0);

	} finally {
		await db()`delete from events where id = ${event}`;
		await db()`delete from families where id = ${family}`;
	}
});

test('email verification token retains a validated return through setup in a fresh browser', async (t) => {
	if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is not set');
	const { db, beginPortalEmail, portalTokenLive, finishPortalSetup } = await import('@tca/school');
	const email = `return-${randomUUID()}@example.com`;
	try {
		const result = await beginPortalEmail(email, path);
		const token = new URL(result.verifyUrl).searchParams.get('token');
		assert.deepEqual(await portalTokenLive(token), { email, next: path });
		const family = await finishPortalSetup({ token, firstName: 'New', lastName: 'Prospect', password: 'test-password-local' });
		assert.deepEqual(family.roles, ['prospect']);
		assert.equal(await portalTokenLive(token), null);
		const other = await beginPortalEmail('other-' + email, 'https://evil.com');
		assert.equal((await portalTokenLive(new URL(other.verifyUrl).searchParams.get('token'))).next, null);
	} finally {
		await db()`delete from families where email in (${email}, ${'other-' + email})`;
	}
});

test('Google callback returns new and existing accounts to RSVP using local provider stubs', async (t) => {
	if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is not set');
	const { GET } = await import('../portal/src/pages/auth/google/callback.ts');
	const { db } = await import('@tca/school');
	const originalFetch = globalThis.fetch;
	const originalId = process.env.GOOGLE_CLIENT_ID;
	const originalSecret = process.env.GOOGLE_CLIENT_SECRET;
	const email = `google-${randomUUID()}@example.com`;
	const sub = randomUUID();
	try {
		process.env.GOOGLE_CLIENT_ID = 'local-test';
		process.env.GOOGLE_CLIENT_SECRET = 'local-test';
		const requested = [];
		globalThis.fetch = async (url) => {
			requested.push(String(url));
			if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'local-test' });
			if (url === 'https://www.googleapis.com/oauth2/v3/userinfo') return Response.json({ sub, email, given_name: 'Google', family_name: 'Example', email_verified: true });
			throw new Error('Unexpected provider request');
		};
		for (const roles of [null, ['guardian'], ['admin'], ['staff']]) {
			if (roles) await db()`update families set roles = ${roles} where email = ${email}`;
			const jar = cookies();
			rememberNext(jar, false, path);
			const state = beginGoogleState(jar, false);
			const url = new URL('http://127.0.0.1/auth/google/callback');
			url.searchParams.set('code', 'local-test');
			url.searchParams.set('state', state);
			const result = await GET({ url, request: new Request(url), cookies: jar, redirect: (target, status = 302) => new Response(null, { status, headers: { location: target } }) });
			assert.equal(result.headers.get('location'), 'http://127.0.0.1' + path);
			assert.equal(result.status, 303);
			assert.ok(jar.values.has('tca_family_session'));
			assert.equal(pendingNext(jar), null);
		}
		// A return started in another tab must not override this OAuth attempt's home landing.
		const jar = cookies();
		const state = beginGoogleState(jar, false);
		rememberNext(jar, false, path);
		const homeUrl = new URL('http://127.0.0.1/auth/google/callback');
		homeUrl.searchParams.set('code', 'local-test');
		homeUrl.searchParams.set('state', state);
		const home = await GET({ url: homeUrl, request: new Request(homeUrl), cookies: jar, redirect: (target, status = 302) => new Response(null, { status, headers: { location: target } }) });
		assert.equal(home.headers.get('location'), 'http://127.0.0.1/home');
		assert.equal(home.status, 303);

		assert.equal(requested.length, 10);
		const url = new URL('http://127.0.0.1/auth/google/callback?code=local&state=forged');
		const denied = await GET({ url, cookies: cookies(), redirect: (target, status = 302) => new Response(null, { status, headers: { location: target } }) });
		assert.equal(denied.headers.get('location'), '/?error=google');
		assert.equal(requested.length, 10, 'Reject forged state before any provider request');
	} finally {
		globalThis.fetch = originalFetch;
		if (originalId === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = originalId;
		if (originalSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET; else process.env.GOOGLE_CLIENT_SECRET = originalSecret;
		await db()`delete from families where email = ${email}`;
	}
});
