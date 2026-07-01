import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const curriculumGuideUrl =
	'https://www.canva.com/design/DAHGYBB12gE/vCl1gN1pwxBef1CGBpkSoA/view?utm_content=DAHGYBB12gE&utm_campaign=designshare&utm_medium=link&utm_source=viewer';

test('curriculum nav and resources guide point to distinct destinations', () => {
	const header = read('src/components/Header.astro');
	const resources = read('src/pages/resources.astro');

	assert.match(header, /\{\s*label:\s*['"]Curriculum['"],\s*href:\s*['"]\/curriculum['"]\s*\}/);
	assert.match(resources, /title:\s*['"]Curriculum Guide['"]/);
	assert.match(resources, /label:\s*['"]CURRICULUM GUIDE['"]/);
	assert.match(resources, new RegExp(`href:\\s*['"]${curriculumGuideUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`));
	assert.match(resources, /external:\s*true/);
	assert.doesNotMatch(resources, /title:\s*['"]Curriculum Information['"]/);
});
