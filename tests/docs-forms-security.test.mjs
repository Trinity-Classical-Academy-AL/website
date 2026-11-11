import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('document downloads are checked against the signed-in family', () => {
	const route = read('portal/src/pages/g/documents/file.ts');
	const data = read('packages/school/src/docs-forms.ts');
	assert.match(route, /readDocumentBytes/);
	assert.match(route, /401/);
	assert.match(data, /seesDoc/);
	assert.match(data, /doc\.familyId === family\.id/);
	assert.match(route, /private, no-store/);
});

test('form reminders are sent only from the confirm action', () => {
	const page = read('portal/src/pages/admin/forms/[id].astro');
	const data = read('packages/school/src/docs-forms.ts');
	assert.match(page, /Send a reminder\?/);
	assert.match(page, /action" value="remind"|name="action" value="remind"/);
	assert.match(data, /status <> 'submitted'/);
	assert.match(data, /sendEmail/);
});

test('a featured event replaces the public popup without rewriting the saved banner', () => {
	const http = read('src/lib/admissions/http.ts');
	assert.match(http, /featuredEvent/);
	assert.doesNotMatch(http, /saveBanner/);
	assert.match(http, /\/api\/events/);
});
