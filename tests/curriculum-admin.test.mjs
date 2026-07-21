import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const urlFor = (path) => new URL(`../${path}`, import.meta.url);
const read = (path) => readFileSync(urlFor(path), 'utf8');

test('footer has the 2026 school copyright without an admin link', () => {
	const footer = read('src/components/Footer.astro');

	assert.match(
		footer,
		/© 2026 Trinity Classical Academy under authority of Trinity Presbyterian Church in Birmingham, Alabama\./,
	);
	assert.doesNotMatch(footer, /href=["']\/admin["']/);
	assert.doesNotMatch(footer, />\s*Admin\s*</);
	assert.doesNotMatch(footer, /© 2026 TCA/);
	assert.doesNotMatch(footer, /CMS/i);
});

test('admin page is not published', () => {
	const pagePath = 'src/pages/admin.astro';

	assert.equal(existsSync(urlFor(pagePath)), false, 'expected /admin page to be absent');
});

test('curriculum content endpoint uses Netlify Blobs and bearer-token protected writes', () => {
	const functionPath = 'netlify/functions/curriculum-content.ts';

	assert.equal(existsSync(urlFor(functionPath)), true, 'expected Netlify function to exist');

	const endpoint = read(functionPath);

	assert.match(endpoint, /@netlify\/blobs/);
	assert.match(endpoint, /getStore\(\{\s*name:\s*['"]site-content['"]/s);
	assert.match(endpoint, /path:\s*["']\/api\/curriculum["']/);
	assert.match(endpoint, /method:\s*\[\s*["']GET["']\s*,\s*["']PUT["']\s*\]/s);
	assert.match(endpoint, /CURRICULUM_ADMIN_TOKEN/);
	assert.match(endpoint, /Authorization/);
	assert.match(endpoint, /store\.setJSON\(["']curriculum["']/);
});
