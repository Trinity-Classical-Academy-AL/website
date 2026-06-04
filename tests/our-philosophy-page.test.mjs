import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('our philosophy page is a direct-only content route', () => {
	const page = read('src/pages/our-philosophy.astro');
	const header = read('src/components/Header.astro');
	const footer = read('src/components/Footer.astro');
	const astroConfig = read('astro.config.mjs');

	assert.match(page, /Our Philosophy Of Education/);
	assert.match(page, /What We Believe About \.\.\./);
	assert.match(page, /TCA Statement on Artistic Discernment/);
	assert.match(page, /Humanities/);
	assert.match(page, /Mathematics/);
	assert.match(page, /The Bible/);
	assert.match(page, /Science/);
	assert.match(page, /History/);
	assert.match(page, /Literature/);
	assert.match(page, /Language/);
	assert.match(page, /Art/);
	assert.match(page, /Music/);

	assert.doesNotMatch(header, /href=["']\/our-philosophy["']/);
	assert.doesNotMatch(footer, /href=["']\/our-philosophy["']/);
	assert.match(astroConfig, /!page\.includes\('\/our-philosophy'\)/);
});
