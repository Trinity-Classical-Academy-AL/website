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

test('times carry a location and an optional video link, from a schedule to each date and to the family', async () => {
	const { cleanMeetingUrl } = await import('../packages/school/src/scheduling/schedule-series.ts');
	assert.equal(cleanMeetingUrl(''), '');
	assert.equal(cleanMeetingUrl('  https://zoom.us/j/123 '), 'https://zoom.us/j/123');
	assert.equal(cleanMeetingUrl('https://meet.google.com/abc-defg-hij'), 'https://meet.google.com/abc-defg-hij');
	assert.equal(cleanMeetingUrl('zoom.us/j/123'), null, 'a link without https:// is refused, not saved broken');
	assert.equal(cleanMeetingUrl('javascript:alert(1)'), null);
	const series = read('packages/school/src/scheduling/schedule-series.ts');
	assert.match(series, /insert into tour_slots \([^)]*location, meeting_url\)[\s\S]*r\.location, r\.meeting_url/, 'generated dates copy the schedule’s location and link');
	assert.match(series, /update tour_slots s set location = r\.location, meeting_url = r\.meeting_url/, 'editing a schedule updates booked dates’ location too');
	const family = read('packages/school/src/tours/family.ts');
	assert.match(family, /s\.location, s\.meeting_url/);
	const holds = read('packages/school/src/tours/holds.ts');
	assert.match(holds, /saved\.slot\.location \|\| CAMPUS/, 'the booking email says where, defaulting to the campus');
	assert.match(holds, /export async function staffCancelHold[\s\S]*?cancelHolds\(db\(\), \{ id \}\)[\s\S]*?\n\}/, 'staff cancel a booking');
	assert.doesNotMatch(holds.match(/export async function staffCancelHold[\s\S]*?\n\}/)[0], /sendTemplate|sendEmail|notifyStaff/, 'staff cancelling sends no email');
});
