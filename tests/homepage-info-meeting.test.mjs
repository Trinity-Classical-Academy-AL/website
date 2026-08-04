import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('homepage mounts the orientation night announcement before the header', () => {
	const page = read('src/pages/index.astro');

	assert.match(page, /import OrientationAnnouncement from '..\/components\/OrientationAnnouncement\.astro';/);
	assert.match(page, /<OrientationAnnouncement \/>\s*<Header \/>/);
});

test('orientation announcement matches the prior flyer-only modal pattern', () => {
	assert.equal(
		existsSync(new URL('../src/components/OrientationAnnouncement.astro', import.meta.url)),
		true,
		'orientation announcement component should exist',
	);
	const component = read('src/components/OrientationAnnouncement.astro');

	assert.match(component, /Upcoming orientation night/);
	assert.match(component, /Thursday, August 6, 2026 · 6:30–8:30 PM/);
	assert.match(component, /\/events\/tca-orientation-august-6-2026\.jpeg/);
	assert.match(component, /data-orientation-modal/);
	assert.match(component, /tca_orientation_night_2026_seen/);
	assert.match(component, /AUTO_OPEN_DELAY_MS = 800/);
	assert.match(component, /event\.key === 'Tab'/);
	assert.match(component, /firstFocusable/);
	assert.match(component, /lastFocusable/);
	assert.doesNotMatch(component, /<form|RSVP|data-netlify/);
});

test('published orientation flyer is the supplied source image unchanged', () => {
	const flyer = readFileSync(new URL('../public/events/tca-orientation-august-6-2026.jpeg', import.meta.url));
	const digest = createHash('sha256').update(flyer).digest('hex');

	assert.equal(flyer.byteLength, 779106);
	assert.equal(digest, '3bb54e45da448dd70a64b452082f4a463d50b72991afb4b55144ade97a67ca37');
});
