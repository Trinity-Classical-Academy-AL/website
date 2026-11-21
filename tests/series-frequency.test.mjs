import assert from 'node:assert/strict';
import { test } from 'node:test';
import { db, dbReady, saveSeries, listSeries, listTourSlotSummary, seriesHits } from '@tca/school';

const dbtest = (name, fn) => test(name, { skip: !process.env.DATABASE_URL }, fn);

test('every N weeks counts from the week the schedule starts', () => {
	const rule = { weekdays: [2], startsOn: '2027-01-05', everyWeeks: 2 }; // a Tuesday
	assert.deepEqual(['2027-01-05', '2027-01-12', '2027-01-19', '2027-01-26'].map((day) => seriesHits(rule, day)), [true, false, true, false]);
	assert.equal(seriesHits({ ...rule, everyWeeks: 3 }, '2027-01-26'), true);
	assert.equal(seriesHits({ ...rule, everyWeeks: 1 }, '2027-01-13'), false, 'wrong weekday');
});

test('monthly picks the nth weekday, and 5 means the last one', () => {
	const second = { weekdays: [2], startsOn: '2027-01-01', monthWeek: 2 };
	assert.equal(seriesHits(second, '2027-01-12'), true);
	assert.equal(seriesHits(second, '2027-01-05'), false);
	const last = { weekdays: [5], startsOn: '2027-01-01', monthWeek: 5 };
	assert.equal(seriesHits(last, '2027-01-29'), true);
	assert.equal(seriesHits(last, '2027-01-22'), false);
	assert.equal(seriesHits(last, '2027-04-30'), true);
});

dbtest('generated tour dates match seriesHits for every-2-weeks and monthly schedules', async (t) => {
	await dbReady();
	const ids = [];
	t.after(async () => {
		await db()`delete from tour_slots where series_id = any(${ids}::uuid[])`;
		await db()`delete from schedule_series where id = any(${ids}::uuid[])`;
	});
	const base = { type: 'tour', start: '05:05', end: '05:35', startsOn: '2027-01-04', endsOn: '2027-06-30', capacity: 1, capacityUnit: 'families', published: false, bookingWindowDays: null };
	for (const pattern of [{ weekdays: [1, 4], everyWeeks: 2 }, { weekdays: [3], monthWeek: 2 }, { weekdays: [5], monthWeek: 5 }]) {
		const saved = await saveSeries({ ...base, ...pattern });
		assert.equal(saved.ok, true, JSON.stringify(saved));
		ids.push(saved.id);
		const rule = (await listSeries()).find((series) => series.id === saved.id);
		const dates = (await listTourSlotSummary()).filter((slot) => slot.seriesId === saved.id).map((slot) => slot.date);
		const expected = [];
		for (const day = new Date('2027-01-04T12:00:00Z'); day <= new Date('2027-06-30T12:00:00Z'); day.setUTCDate(day.getUTCDate() + 1)) {
			const iso = day.toISOString().slice(0, 10);
			if (seriesHits(rule, iso)) expected.push(iso);
		}
		assert.deepEqual(dates, expected, JSON.stringify(pattern));
		assert.ok(expected.length > 4);
	}
	const monthly = await saveSeries({ ...base, weekdays: [1, 2], monthWeek: 1 });
	assert.equal(monthly.ok, false, 'monthly needs one weekday');
});
