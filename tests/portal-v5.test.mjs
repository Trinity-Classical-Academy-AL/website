import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('tour times stay in a side sheet, with published capacity and a 10 MB flyer limit', () => {
	const tours = read('portal/src/pages/admin/tours.astro');
	const css = read('portal/public/css/portal.css');
	const schema = read('packages/school/src/schema.ts');
	const defaults = read('src/lib/admissions/defaults.ts');
	assert.match(tours, /class="ov ov-side"/);
	assert.match(tours, /Add time/);
	assert.match(tours, /name="published"/);
	assert.match(tours, /People, including children/);
	assert.doesNotMatch(tours, /<h2 class="h2">Add a time<\/h2>\s*<form/);
	assert.match(css, /\.ssheet\{/);
	assert.match(schema, /published boolean/);
	assert.match(schema, /prospect_children/);
	assert.match(defaults, /10 \* 1024 \* 1024/);
});

test('the banner editor keeps the popup fields and the design validation copy', () => {
	const page = read('portal/src/pages/admin/website.astro');
	const validation = read('src/lib/admissions/validation.ts');
	assert.match(page, /Website & announcements/);
	assert.match(page, /Open the flyer popup/);
	assert.match(page, /name="rsvpUrl"/);
	assert.match(page, /Banner saved\. Live on the website now\./);
	assert.match(page, /10 MB/);
	assert.match(validation, /Shorten to 120 characters or fewer\./);
	assert.match(validation, /Stop date is before the start date\./);
});

test('request a tour no longer asks for phone or grades', () => {
	const tour = read('portal/src/pages/tour.astro');
	assert.match(tour, /How many people are coming\?/);
	assert.match(tour, /Days that work/);
	assert.doesNotMatch(tour, /Children’s grades/);
	assert.doesNotMatch(tour, /name="phone"/);
});

test('sign-in keeps the Google handoff out of the client router', () => {
	const page = read('portal/src/pages/index.astro');
	assert.match(page, /data-astro-reload/);
	assert.match(page, /Google sign-in didn’t finish/);
	assert.match(page, /You’re signed out/);
});
