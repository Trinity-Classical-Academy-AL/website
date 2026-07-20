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

test("Justin Wallick's faculty card uses his portrait", () => {
	const page = read('src/pages/people.astro');
	const portrait = readFileSync(
		new URL('../src/assets/images/justin-wallick.jpg', import.meta.url),
	);

	assert.match(page, /import justinImg from '\.\.\/assets\/images\/justin-wallick\.jpg';/);
	assert.match(
		page,
		/name: 'Justin Wallick',\s+role: 'Primary E',\s+image: justinImg,/,
	);
	assert.deepEqual([...portrait.subarray(0, 3)], [0xff, 0xd8, 0xff]);
	assert.ok(portrait.length > 100_000 && portrait.length < 500_000);
});
