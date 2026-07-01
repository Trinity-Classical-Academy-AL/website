import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const urlFor = (path) => new URL(`../${path}`, import.meta.url);
const read = (path) => readFileSync(urlFor(path), 'utf8');

test('footer has the 2026 school copyright with a discreet admin link', () => {
	const footer = read('src/components/Footer.astro');

	assert.match(
		footer,
		/© 2026 Trinity Classical Academy under authority of Trinity Presbyterian Church in Birmingham, Alabama\./,
	);
	assert.match(footer, /href=["']\/admin["']/);
	assert.match(footer, />\s*Admin\s*</);
	assert.doesNotMatch(footer, /© 2026 TCA/);
	assert.doesNotMatch(footer, /CMS/i);
});

test('admin page edits curriculum title and markdown body without being indexed', () => {
	const pagePath = 'src/pages/admin.astro';

	assert.equal(existsSync(urlFor(pagePath)), true, 'expected /admin page to exist');

	const page = read(pagePath);

	assert.match(page, /noindex/);
	assert.match(page, /Curriculum Admin/);
	assert.match(page, /name=["']title["']/);
	assert.match(page, /name=["']bodyMarkdown["']/);
	assert.match(page, /data-admin-form/);
	assert.match(page, /data-preview/);
	assert.doesNotMatch(page, /CMS/i);
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
