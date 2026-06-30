import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('people page displays the current faculty cohort labels', () => {
	const page = read('src/pages/people.astro');

	assert.match(page, /name: 'Julie McDonald',\s+role: 'Kindergarten'/);
	assert.match(page, /name: 'Amy Griffith',\s+role: 'Primary A'/);
	assert.match(page, /name: 'Ashlea Hamblin',\s+role: 'Primary C'/);
	assert.match(page, /name: 'Justin Wallick',\s+role: 'Primary E'/);
	assert.match(page, /name: 'Ashton Moats',\s+role: 'Secondary Prep'/);
	assert.match(page, /name: 'David Diggs',\s+role: 'Math for Primary E & Secondary Prep'/);

	assert.doesNotMatch(page, /Primary B/);
});
