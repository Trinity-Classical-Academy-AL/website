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

test('Brian Moats appears in Founding Faculty as Chapel Leader with his portrait', () => {
	const page = read('src/pages/people.astro');

	assert.match(
		page,
		/import brianImg from '\.\.\/assets\/images\/brian-moats\.jpg';/,
	);
	assert.match(
		page,
		/name: 'Brian Moats',\s+role: 'Chapel Leader',\s+image: brianImg,/,
	);

	const portrait = readFileSync(
		new URL('../src/assets/images/brian-moats.jpg', import.meta.url),
	);
	assert.deepEqual([...portrait.subarray(0, 3)], [0xff, 0xd8, 0xff]);
	assert.ok(portrait.length > 100_000 && portrait.length < 500_000);
});

test("Brian Moats's faculty card is zoomed/cropped upward and no other faculty card is", () => {
	const page = read('src/pages/people.astro');

	assert.match(
		page,
		/name: 'Brian Moats',\s+role: 'Chapel Leader',\s+image: brianImg,\s+zoom: true,/,
	);

	const facultyBlock = page.slice(page.indexOf('const faculty = ['), page.indexOf('];\n\n// Derive initials'));
	const otherMembers = facultyBlock.replace(/name: 'Brian Moats',[\s\S]*?\},/, '');
	assert.doesNotMatch(otherMembers, /zoom: true/);

	assert.match(
		page,
		/member\.zoom && 'origin-top scale-\[1\.15\] -translate-y-\[3%\]'/,
	);
});
