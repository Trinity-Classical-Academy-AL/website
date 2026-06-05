import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('homepage no longer mounts the past informational meeting announcement', () => {
	const page = read('src/pages/index.astro');

	assert.doesNotMatch(page, /InfoMeetingAnnouncement/);
	assert.doesNotMatch(page, /data-info-meeting-/);
	assert.doesNotMatch(page, /tca-info-meeting-june-4/);
	assert.doesNotMatch(page, /Upcoming informational meeting night/);
});
