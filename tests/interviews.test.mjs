import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Interviews reuse the tour booking engine: shared times staff post on the calendar,
// bookable only by families the school has invited (application at the Interview stage).
test('interview times are only bookable by invited families, and never replace a tour booking', () => {
	const reserve = read('packages/school/src/scheduling/reserve.ts');
	assert.match(reserve, /slot\.slot_type === 'interview'/);
	assert.match(reserve, /pg_advisory_xact_lock\(hashtext\(\$\{'family:' \+ party\.familyId\}\)\)[\s\S]*pg_advisory_xact_lock\(hashtext\(\$\{slotId\}\)\)/, 'family lock before slot lock: one booking per family even when two arrive at once');
	assert.match(reserve, /from applications where family_id = \$\{party\.familyId\} and status = 'interview'/);
	assert.match(reserve, /\(coalesce\(t\.slot_type, 'tour'\) = 'interview'\) = \$\{interview\}/);
});

test('the calendar offers Interview as a type and the tour page never lists interview times', async () => {
	const { CALENDAR_TYPES } = await import('../packages/school/src/calendar.ts');
	assert.ok(CALENDAR_TYPES.some((item) => item.value === 'interview'));
	const family = read('packages/school/src/tours/family.ts');
	assert.match(family, /\(s\.slot_type = 'interview'\) = \$\{kind === 'interview'\}/);
	const website = read('packages/school/src/tours/website.ts');
	assert.match(website, /s\.type === 'tour'/);
});
