import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('404 page uses school-related playful copy', () => {
	const page = read('src/pages/404.astro');

	assert.match(page, /Absent from<br \/>homeroom\./);
	assert.doesNotMatch(page, /Lost in the/i);
	assert.doesNotMatch(page, /narthex/i);
});
