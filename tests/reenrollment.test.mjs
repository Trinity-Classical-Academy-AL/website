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
