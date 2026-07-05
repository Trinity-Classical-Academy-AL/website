import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { defaultCurriculumContent } from '../src/lib/curriculumContent.ts';

const urlFor = (path) => new URL(`../${path}`, import.meta.url);
const read = (path) => readFileSync(urlFor(path), 'utf8');

test('curriculum page publishes the expanded guide content as a readable route', () => {
	const pagePath = 'src/pages/curriculum.astro';

	assert.equal(existsSync(urlFor(pagePath)), true, 'expected /curriculum page file to exist');
	assert.equal(
		existsSync(urlFor('src/pages/curriculum/guide.astro')),
		false,
		'expected expanded guide content to live at /curriculum instead of /curriculum/guide',
	);

	const page = read(pagePath);
	const body = defaultCurriculumContent.bodyMarkdown;

	assert.match(page, /canonicalPath=["']\/curriculum["']/);
	assert.match(page, /data-curriculum-title/);
	assert.match(page, /data-curriculum-body/);
	assert.match(page, /\/api\/curriculum/);
	assert.match(body, /Integrated Humanities/);
	assert.match(body, /Latin \(Primary E and up\)/);
	assert.match(body, /Music/);
	assert.match(body, /Art/);
	assert.match(body, /Logic \(Secondary Prep\)/);
	assert.match(body, /Grammar and Writing/);
	assert.match(body, /Spelling\/Phonics/);
	assert.match(body, /Geography/);
	assert.match(body, /Science/);
	assert.match(body, /Mathematics/);
	assert.doesNotMatch(page + body, /First Cycle/);
	assert.doesNotMatch(page + body, /Scope/);
	assert.doesNotMatch(body, /Primary [BD]\b/);
	assert.doesNotMatch(body, /Primary C (?:and up|level)/);
	assert.doesNotMatch(body, /<em\b|<i\b|font-[^"']*italic|italic[^"']*font-/);
});
