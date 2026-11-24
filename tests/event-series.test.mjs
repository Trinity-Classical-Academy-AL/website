import { test } from 'node:test';
import assert from 'node:assert/strict';

// Dates well in the future so "from today on" covers every occurrence.
const add = (date, days) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const nextTuesday = () => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 60); while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

test('repeating events: create, change this date / this and following / all, delete by scope', async (t) => {
	if (!process.env.DATABASE_URL) { t.skip('DATABASE_URL is not set'); return; }
	const { db, dbReady, createEventSeries, updateEventSeries, updateEventSeriesFrom, detachEventOccurrence, saveCalendarEvent, deleteEventOccurrence, deleteEventSeriesFrom, getEventSeries, restoreEventSeriesDate } = await import('@tca/school');
	await dbReady();
	const first = nextTuesday();
	const title = `Chapel ${Date.now()}`;
	const template = { type: 'gathering', title, start: '08:30', end: '09:00', allDay: false, audience: ['enrolled'], rsvp: false, capacity: '', location: 'Chapel', description: '' };
	const rule = { weekdays: [2], everyWeeks: 1, monthWeek: null, startsOn: first, endsOn: add(first, 35) };
	const ids = new Set();
	const rows = async () => (await db()`select id, title, series_id, location, (starts_at at time zone 'America/Chicago')::date::text as day, to_char(starts_at at time zone 'America/Chicago', 'HH24:MI') as at from events where title like ${title + '%'} order by starts_at`);
	try {
		const created = await createEventSeries(template, rule);
		assert.equal(created.ok, true);
		ids.add(created.id);
		assert.equal(created.dates, 6, 'six Tuesdays');

		// This date: the third Tuesday moves to 9:00 alone and leaves the series.
		const third = (await rows())[2];
		await detachEventOccurrence(third.id);
		assert.equal((await saveCalendarEvent({ id: third.id, ...template, start: '09:00', end: '09:30', date: third.day })).ok, true);
		let all = await rows();
		assert.equal(all.length, 6);
		assert.equal(all[2].at, '09:00');
		assert.equal(all[2].series_id, null);
		assert.deepEqual((await getEventSeries(created.id)).skipDates, [], 'a date changed alone isn’t listed as skipped');

		// All dates: new location everywhere except the detached one.
		assert.deepEqual(await updateEventSeries(created.id, { ...template, location: 'Sanctuary' }, rule), { ok: true });
		all = await rows();
		assert.deepEqual(all.map((row) => row.location), ['Sanctuary', 'Sanctuary', 'Chapel', 'Sanctuary', 'Sanctuary', 'Sanctuary']);
		assert.equal(all.length, 6, 'the detached date isn’t regenerated');

		// This and following from the fifth: they become 10:00 in a new series.
		const fifth = all[4];
		const split = await updateEventSeriesFrom(created.id, fifth.day, { ...template, location: 'Sanctuary', start: '10:00', end: '10:30' }, rule);
		assert.equal(split.ok, true);
		ids.add(split.id);
		all = await rows();
		assert.deepEqual(all.map((row) => row.at), ['08:30', '08:30', '09:00', '08:30', '10:00', '10:00']);
		assert.equal(all[4].id, fifth.id, 'existing dates are kept (with their RSVPs)');
		assert.equal((await getEventSeries(created.id)).endsOn, add(fifth.day, -1));

		// Delete this date only, then restore it.
		await deleteEventOccurrence(all[0].id);
		assert.equal((await rows()).length, 5);
		assert.deepEqual((await getEventSeries(created.id)).skipDates, [first]);
		await restoreEventSeriesDate(created.id, first);
		assert.equal((await rows()).length, 6);

		// Delete this and following from the second date, then all of the second series.
		const second = (await rows())[1];
		assert.equal((await deleteEventSeriesFrom(created.id, second.day)).ok, true);
		assert.deepEqual((await rows()).map((row) => row.day), [first, third.day, all[4].day, all[5].day]);
		assert.equal((await deleteEventSeriesFrom(split.id, '')).ok, true);
		assert.deepEqual((await rows()).map((row) => row.day), [first, third.day]);
		assert.equal(await getEventSeries(split.id), null, 'deleting all removes the rule');
	} finally {
		await db()`delete from events where title like ${title + '%'}`;
		for (const id of ids) await db()`delete from event_series where id = ${id}`;
	}
});

test('repeating tours: change one date alone, split from a date, delete from a date', async (t) => {
	if (!process.env.DATABASE_URL) { t.skip('DATABASE_URL is not set'); return; }
	const { db, dbReady, saveSeries, splitSeries, detachSeriesOccurrence, updateTourSlot, deleteSeriesFrom, deleteSeries, listSeries } = await import('@tca/school');
	await dbReady();
	const first = nextTuesday();
	const base = { type: 'tour', weekdays: [2], start: '07:13', end: '08:13', startsOn: first, endsOn: add(first, 28), capacity: 3, capacityUnit: 'families', published: false };
	const created = await saveSeries(base);
	assert.equal(created.ok, true);
	const made = [created.id];
	const slots = async () => (await db()`select id, series_id, slot_date::text as day, start_time, capacity from tour_slots where series_id = any(${made}::uuid[]) or detached_from = any(${made}::uuid[]) order by slot_date`);
	try {
		assert.equal((await slots()).length, 5);
		const second = (await slots())[1];
		await detachSeriesOccurrence(second.id);
		assert.equal((await updateTourSlot({ id: second.id, date: second.day, start: '07:14', end: '08:14', capacity: 9, type: 'tour', published: false })).ok, true);
		let all = await slots();
		assert.equal(all.length, 5, 'not regenerated');
		assert.equal(all[1].capacity, 9);
		assert.deepEqual((await listSeries()).find((series) => series.id === created.id).skipDates, [], 'changed alone isn’t listed as skipped');

		const split = await splitSeries(created.id, all[3].day, { ...base, capacity: 5 });
		assert.equal(split.ok, true);
		made.push(split.id);
		all = await slots();
		assert.deepEqual(all.map((slot) => slot.capacity), [3, 9, 3, 5, 5]);
		assert.equal(all[3].series_id, split.id);

		assert.equal((await deleteSeriesFrom(split.id, all[4].day)).ok, true);
		assert.deepEqual((await slots()).map((slot) => slot.day), all.slice(0, 4).map((slot) => slot.day));
	} finally {
		for (const id of made) await deleteSeries(id).catch(() => {});
		await db()`delete from tour_slots where detached_from = any(${made}::uuid[]) or series_id = any(${made}::uuid[])`;
		await db()`delete from schedule_series where id = any(${made}::uuid[])`;
	}
});
