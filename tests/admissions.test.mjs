import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { isAllowedAdminOrigin, sessionCookieHeader, signSession, tokensMatch, verifySession } from '../src/lib/admissions/auth.ts';
import { bannerVersion, isBannerActive, emptyBanner } from '../src/lib/admissions/banner.ts';
import { csvEscape } from '../src/lib/admissions/csv.ts';
import { nthWeekdayOfMonth, seasonYear, schoolYearLabel, defaultTourDates } from '../src/lib/admissions/dates.ts';
import { TOUR_DEFAULTS } from '../src/lib/admissions/defaults.ts';
import { createTourRequest, publicTourSchedule } from '../src/lib/admissions/repository.ts';
import { db, dbReady, saveTourDates } from '@tca/school';
import { errorSummary, validateInterest, validateTourRequest } from '../src/lib/admissions/validation.ts';

test('tours fall on the second Wednesday of January, February, and March', () => {
	assert.equal(nthWeekdayOfMonth(2027, 1, 3, 2), '2027-01-13');
	assert.equal(nthWeekdayOfMonth(2027, 2, 3, 2), '2027-02-10');
	assert.equal(nthWeekdayOfMonth(2027, 3, 3, 2), '2027-03-10');
	assert.equal(seasonYear('2026-11-02'), 2027);
	assert.equal(schoolYearLabel(2027), '2027–28');
	assert.deepEqual(
		defaultTourDates('2026-11-02').map((date) => date.date),
		['2027-01-13', '2027-02-10', '2027-03-10'],
	);
	assert.equal(defaultTourDates('2026-11-02')[0].capacity, 12);
	assert.equal(TOUR_DEFAULTS.startTime, '09:00');
	assert.equal(TOUR_DEFAULTS.endTime, '10:00');
	assert.equal(TOUR_DEFAULTS.dismissalStorageKey, 'tca:banner:dismissed');
});

test('tour validation matches the approved field messages', () => {
	const result = validateTourRequest({
		parentName: '',
		email: 'jordan.smith@',
		phone: '205-555',
		grades: [],
		tourDateId: '',
	});
	assert.equal(result.errors.parentName, 'Enter your name');
	assert.equal(result.errors.email, 'Enter a valid email address like name@example.com');
	assert.equal(result.errors.phone, 'Enter a 10-digit phone number');
	assert.equal(result.errors.grades, 'Enter at least one grade');
	assert.equal(result.errors.tourDateId, 'Choose at least one date');
	assert.equal(Object.keys(result.errors).length, 5);
	assert.equal(errorSummary(5), 'Please fix 5 fields before sending. Each one is marked below.');

	const interest = validateInterest({ name: '', email: 'not-an-email', pagePath: '/admissions' });
	assert.equal(interest.errors.name, 'Enter your name');
	assert.ok(interest.errors.email);
});

test('banner dismissal version changes when the text changes and respects the date window', () => {
	const banner = {
		...emptyBanner(),
		enabled: true,
		text: 'New Family Info Night',
		startsOn: '2027-01-04',
		endsOn: '2027-01-21',
	};
	const changed = { ...banner, text: 'Spring tours are open' };
	assert.notEqual(bannerVersion(banner), bannerVersion(changed));
	assert.equal(isBannerActive(banner, new Date('2027-01-10T18:00:00Z')), true);
	assert.equal(isBannerActive(banner, new Date('2027-01-03T18:00:00Z')), false);
	assert.equal(isBannerActive({ ...banner, enabled: false }, new Date('2027-01-10T18:00:00Z')), false);
});

test('admin token compare rejects mismatches and sessions expire', () => {
	assert.equal(tokensMatch('correct-token', 'correct-token'), true);
	assert.equal(tokensMatch('correct-token', 'other-token-value'), false);
	assert.equal(tokensMatch('short', 'correct-token'), false);
	assert.equal(tokensMatch('', 'correct-token'), false);
	const secret = 'test-secret-value';
	const cookie = signSession(secret, Date.parse('2026-11-02T00:00:00Z'));
	assert.equal(verifySession(secret, cookie, Date.parse('2026-11-02T00:00:00Z') + 1000), true);
	assert.equal(verifySession('other-secret-value', cookie, Date.parse('2026-11-02T00:00:00Z') + 1000), false);
	assert.equal(verifySession(secret, cookie, Date.parse('2027-01-15T00:00:00Z')), false);
	assert.equal(csvEscape('=cmd'), "'=cmd");
	assert.equal(isAllowedAdminOrigin('https://admin.trinityclassical.academy'), true);
	assert.equal(isAllowedAdminOrigin('https://evil.example'), false);
	const crossSite = new Request('https://trinityclassical.academy/api/admin/session', {
		headers: { origin: 'https://admin.trinityclassical.academy', 'x-forwarded-proto': 'https' },
	});
	const crossCookie = sessionCookieHeader('abc', crossSite, 10);
	assert.match(crossCookie, /HttpOnly/);
	assert.match(crossCookie, /SameSite=None/);
	assert.match(crossCookie, /Secure/);
	const local = new Request('http://127.0.0.1:4321/api/admin/session');
	const localCookie = sessionCookieHeader('abc', local, 10);
	assert.match(localCookie, /SameSite=Lax/);
	assert.doesNotMatch(localCookie, /Secure/);
});

test('a full tour date rejects the next family and keeps the first', async (t) => {
	if (!process.env.DATABASE_URL) {
		t.skip('DATABASE_URL is not set');
		return;
	}
	const dir = await mkdtemp(join(tmpdir(), 'tca-admissions-'));
	process.env.ADMISSIONS_STORE = 'file';
	process.env.ADMISSIONS_DATA_DIR = dir;
	await dbReady();
	await db()`truncate table activity, rsvps, questions, tour_bookings, tour_requests, tour_holds, interest_notes, inquiries, tour_dates, tour_slots, email_tokens, time_requests, students, announcements, auth_attempts, updates_list, families, settings, events restart identity`;
	await saveTourDates([{ date: '2027-01-13', startTime: '09:00', endTime: '10:00', capacity: 1, enabled: true }]);
	const input = {
		parentName: 'Jordan Smith',
		email: 'jordan.smith@example.com',
		phone: '2055550142',
		children: 2,
		grades: ['K'],
		tourDateId: '2027-01-13',
		hearAbout: 'friend',
		message: '',
	};
	const first = await createTourRequest(input);
	const second = await createTourRequest({ ...input, email: 'ada@example.com', parentName: 'Ada Lovelace' });
	assert.equal(first.ok, true);
	assert.equal(second.ok, false);
	if (!second.ok) assert.equal(second.code, 'date_full');
	const schedule = await publicTourSchedule(new Date('2026-11-02T15:00:00Z'));
	assert.equal(schedule.dates[0].remaining, 0);
	assert.equal(schedule.dates[0].full, true);
	assert.equal(schedule.bookable, 0);
	await rm(dir, { recursive: true, force: true });
});
