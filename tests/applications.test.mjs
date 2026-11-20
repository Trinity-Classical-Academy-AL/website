import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSchoolYear, schoolYearOf, shiftSchoolYear } from '../packages/school/src/applications.ts';

test('school years turn over on August 1 and read from loose form answers', () => {
	assert.equal(schoolYearOf('2026-07-31'), '2025–26');
	assert.equal(schoolYearOf('2026-08-01'), '2026–27');
	assert.equal(shiftSchoolYear('2026–27', 1), '2027–28');
	assert.equal(shiftSchoolYear('2026–27', -2), '2024–25');
	for (const answer of ['2027-2028', '2027–28', '2027/28', 'Fall 2027', '2027 - 28']) assert.equal(normalizeSchoolYear(answer, '2026-11-20'), '2027–28');
	assert.equal(normalizeSchoolYear('', '2026-11-20'), '2026–27');
});
