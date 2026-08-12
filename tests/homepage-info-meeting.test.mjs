import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const urlFor = (path) => new URL(`../${path}`, import.meta.url);
const read = (path) =>
	process.env.FLYER_TEST_BASELINE === '1'
		? execFileSync('git', ['show', `HEAD:${path}`], {
				cwd: new URL('..', import.meta.url),
				encoding: 'utf8',
			})
		: readFileSync(urlFor(path), 'utf8');

const exists = (path) => {
	if (process.env.FLYER_TEST_BASELINE !== '1') return existsSync(urlFor(path));
	try {
		execFileSync('git', ['cat-file', '-e', `HEAD:${path}`], {
			cwd: new URL('..', import.meta.url),
			stdio: 'ignore',
		});
		return true;
	} catch {
		return false;
	}
};

test('homepage no longer publishes the passed orientation flyer', () => {
	const page = read('src/pages/index.astro');

	assert.doesNotMatch(page, /OrientationAnnouncement/);
	assert.doesNotMatch(page, /tca-orientation-august-6-2026/);
	assert.equal(
		exists('public/events/tca-orientation-august-6-2026.jpeg'),
		false,
		'passed orientation flyer should no longer be publicly addressable',
	);
});

test('reusable flyer component stays available with optional expiration', () => {
	assert.equal(
		exists('src/components/OrientationAnnouncement.astro'),
		true,
		'flyer announcement component should remain available',
	);

	const component = read('src/components/OrientationAnnouncement.astro');

	assert.match(component, /interface Props/);
	assert.match(component, /expirationDate\?: string/);
	assert.match(component, /expirationTimeZone\?: string/);
	assert.match(component, /isFlyerExpired\(expirationDate/);
	assert.match(component, /data-flyer-announcement/);
	assert.match(component, /window\.setInterval\(expireIfNeeded/);
	assert.match(component, /AUTO_OPEN_DELAY_MS = 800/);
	assert.match(component, /event\.key === 'Tab'/);
	assert.match(component, /firstFocusable/);
	assert.match(component, /lastFocusable/);
	assert.match(component, /window\.clearTimeout\(autoOpenTimer\)/);
	assert.doesNotMatch(component, /Upcoming orientation night/);
	assert.doesNotMatch(component, /tca-orientation-august-6-2026/);
	assert.doesNotMatch(component, /<form|RSVP|data-netlify/);
});

test('flyer expiration is optional and passes through the named calendar date', async () => {
	const helperPath = 'src/lib/flyerExpiration.ts';
	assert.equal(
		existsSync(urlFor(helperPath)),
		true,
		'flyer expiration helper should exist',
	);

	const { isFlyerExpired } = await import(urlFor(helperPath));

	assert.equal(isFlyerExpired(undefined, new Date('2030-01-01T00:00:00Z')), false);
	assert.equal(
		isFlyerExpired('2026-08-06', new Date('2026-08-07T04:59:59Z'), 'America/Chicago'),
		false,
		'flyer should remain active through August 6 in Central Time',
	);
	assert.equal(
		isFlyerExpired('2026-08-06', new Date('2026-08-07T05:00:00Z'), 'America/Chicago'),
		true,
		'flyer should expire when August 7 begins in Central Time',
	);
	assert.throws(() => isFlyerExpired('08/06/2026'), /YYYY-MM-DD/);
});
