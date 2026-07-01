import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	defaultCurriculumContent,
	renderCurriculumMarkdown,
	validateCurriculumContent,
} from '../src/lib/curriculumContent.ts';

test('default curriculum content is a title and markdown body', () => {
	assert.equal(defaultCurriculumContent.title, 'Curriculum Overview');
	assert.match(defaultCurriculumContent.bodyMarkdown, /^## Integrated Humanities/m);
	assert.match(defaultCurriculumContent.bodyMarkdown, /^## Latin \(Primary E and up\)/m);
	assert.match(defaultCurriculumContent.bodyMarkdown, /^## School Events/m);
	assert.doesNotMatch(defaultCurriculumContent.bodyMarkdown, /Primary [BD]\b/);
	assert.doesNotMatch(defaultCurriculumContent.bodyMarkdown, /Primary C (?:and up|level)/);
});

test('curriculum markdown renderer separates headings, paragraphs, and lists', () => {
	const html = renderCurriculumMarkdown(`## Heading

Opening paragraph.

- First item
- Second item

### Subheading

More text.`);

	assert.match(html, /<h2>Heading<\/h2>/);
	assert.match(html, /<p>Opening paragraph\.<\/p>/);
	assert.match(html, /<ul>\s*<li>First item<\/li>\s*<li>Second item<\/li>\s*<\/ul>/);
	assert.match(html, /<h3>Subheading<\/h3>/);
});

test('curriculum markdown renderer escapes unsafe html while allowing basic inline markdown', () => {
	const html = renderCurriculumMarkdown(
		'This is **strong** and [linked](https://trinityclassical.academy). <script>alert(1)</script>',
	);

	assert.match(html, /<strong>strong<\/strong>/);
	assert.match(
		html,
		/<a href="https:\/\/trinityclassical\.academy" rel="noopener noreferrer">linked<\/a>/,
	);
	assert.doesNotMatch(html, /<script>/);
	assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('curriculum content validation rejects empty and oversized submissions', () => {
	assert.deepEqual(validateCurriculumContent({ title: '  Updated  ', bodyMarkdown: '  Body  ' }), {
		ok: true,
		value: {
			title: 'Updated',
			bodyMarkdown: 'Body',
		},
	});

	assert.equal(validateCurriculumContent({ title: '', bodyMarkdown: 'Body' }).ok, false);
	assert.equal(validateCurriculumContent({ title: 'Title', bodyMarkdown: '' }).ok, false);
	assert.equal(
		validateCurriculumContent({ title: 'Title', bodyMarkdown: 'x'.repeat(60001) }).ok,
		false,
	);
});
