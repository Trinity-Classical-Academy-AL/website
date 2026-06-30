import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

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

	assert.match(page, /canonicalPath=["']\/curriculum["']/);
	assert.match(page, /Integrated Humanities/);
	assert.match(page, /Latin \(Primary E and up\)/);
	assert.match(page, /Music/);
	assert.match(page, /Art/);
	assert.match(page, /Logic \(Secondary Prep\)/);
	assert.match(page, /Grammar and Writing/);
	assert.match(page, /Spelling\/Phonics/);
	assert.match(page, /Geography/);
	assert.match(page, /Science/);
	assert.match(page, /Mathematics/);
	assert.match(page, /School Events/);
	assert.match(page, /Strengths of the Berean Builders Science Approach/);
	assert.match(page, /Strengths of the Singapore Math Approach/);
	assert.doesNotMatch(page, /First Cycle/);
	assert.doesNotMatch(page, /Scope/);
	assert.doesNotMatch(page, /Primary [BD]\b/);
	assert.doesNotMatch(page, /Primary C (?:and up|level)/);
	assert.doesNotMatch(page, /<em\b|<i\b|font-[^"']*italic|italic[^"']*font-/);
});
