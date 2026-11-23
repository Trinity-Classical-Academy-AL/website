import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextGrade } from '../packages/school/src/reenrollment.ts';

test('next year grade: PK to K, K to 1, numbers up by one, other labels unchanged', () => {
	assert.equal(nextGrade('PK'), 'K');
	assert.equal(nextGrade('K'), '1');
	assert.equal(nextGrade('k'), '1');
	assert.equal(nextGrade('3'), '4');
	assert.equal(nextGrade('Upper school'), 'Upper school');
	assert.equal(nextGrade(''), '');
});

test('families answer their own children while re-enrollment is open; returning counts right away', async () => {
	const { seasonOpen } = await import('../packages/school/src/reenrollment.ts');
	const season = { next: '2027–28', deadline: '2027-02-15', formId: null, highestGrade: '7', openedAt: '', openedBy: '' };
	assert.equal(seasonOpen(null, '2027-01-01'), false);
	assert.equal(seasonOpen(season, '2027-02-15'), true);
	assert.equal(seasonOpen(season, '2027-02-16'), false);
	const { readFileSync } = await import('node:fs');
	const source = readFileSync(new URL('../packages/school/src/reenrollment.ts', import.meta.url), 'utf8');
	assert.match(source, /String\(row\.family_id\) !== input\.familyId/);
	assert.match(source, /status = \$\{input\.returning \? 'enrolled' : 'withdrawn'\}/);
	assert.match(source, /graduating \? 'graduated' : 'pending'/);
});
