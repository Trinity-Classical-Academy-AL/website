import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import postgres from 'postgres';
import { db, dbReady, chicagoToday, addTourSlot, deleteTourSlot, familyTourView, saveSlotBooking, listAdminTours, listTourSlotSummary,
	listTourRules, saveTourRule, skipTourRuleDate, deleteTourRule, materializeTourOccurrences, replyToTourRequest, acceptProposedHold, TOUR_NOTE, websiteTourSlots } from '@tca/school';
import { handleAdmissionsRequest } from '../src/lib/admissions/http.ts';

const dbtest = (name, fn) => test(name, { skip: !process.env.DATABASE_URL }, fn);
const addDays = (value, days) => { const d = new Date(value + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const today = chicagoToday();
async function fixtures(t) {
	await dbReady();
	const families = [randomUUID(), randomUUID(), randomUUID()];
	for (const id of families) await db()`insert into families (id, name, email, phone, roles) values (${id}, ${'Tour test'}, ${id + '@example.com'}, '', ${['prospect']})`;
	const rules = [], slots = [];
	t.after(async () => {
		await db()`delete from families where id = any(${families}::uuid[])`;
		await db()`delete from tour_slots where rule_id = any(${rules}::uuid[]) or id = any(${slots}::uuid[])`;
		await db()`delete from tour_slot_rules where id = any(${rules}::uuid[])`;
	});
	return {
		families,
		async rule(overrides = {}) {
			const input = { type: 'tour', weekdays: [3,4], start: '04:10', end: '04:50', startsOn: addDays(today, -10), endsOn: addDays(today, 100), capacity: 1, capacityUnit: 'families', published: true, ...overrides };
			const result = await saveTourRule(input); assert.equal(result.ok, true, JSON.stringify(result)); rules.push(result.id);
			return { ...input, id: result.id };
		},
		async slot(overrides = {}) {
			const input = { date: addDays(today, 4), start: '03:00', end: '03:30', capacity: 1, capacityUnit: 'families', published: true, ...overrides };
			const result = await addTourSlot(input); assert.equal(result.ok, true, JSON.stringify(result)); slots.push(result.id); return { ...input, id: result.id };
		},
		book(slotId, familyId = families[0], headCount = 1) { return saveSlotBooking({ slotId, familyId, familyName: 'Tour test', email: familyId + '@example.com', phone: '', grades: [], note: '', headCount }); },
	};
}
const occurrences = async id => (await listTourSlotSummary()).filter(s => s.ruleId === id);

dbtest('occurrences match weekdays, Chicago window, skips and a one-off clash, idempotently', async t => {
	const f = await fixtures(t);
	const clashDate = Array.from({ length: 7 }, (_, i) => addDays(today, i)).find(date => new Date(date).getUTCDay() === 3);
	const clash = await f.slot({ date: clashDate, start: '04:10', end: '04:50' });
	const rule = await f.rule();
	const skipped = addDays(clashDate, 7);
	assert.ok((await skipTourRuleDate(rule.id, skipped)).ok);
	const first = await occurrences(rule.id);
	const expected = Array.from({ length: 57 }, (_, i) => addDays(today, i)).filter(date => [3,4].includes(new Date(date).getUTCDay()) && ![clashDate, skipped].includes(date));
	assert.deepEqual(first.map(s => s.date), expected);
	assert.ok(first.every(s => s.capacityUnit === 'families' && s.capacity === 1 && s.published));
	assert.ok((await listTourSlotSummary()).some(s => s.id === clash.id && s.ruleId === ''));
	await materializeTourOccurrences();
	assert.deepEqual((await occurrences(rule.id)).map(s => s.id), first.map(s => s.id));
	// Explicit starts/ends bounds inside the rolling window.
	const bounded = await f.rule({ start: '04:11', end: '04:51', weekdays: [0,1,2,3,4,5,6], startsOn: addDays(today, 3), endsOn: addDays(today, 6) });
	assert.deepEqual((await occurrences(bounded.id)).map(s => s.date), [3,4,5,6].map(d => addDays(today, d)));
});

dbtest('a skipped occurrence never returns through any list; restore regenerates it', async t => {
	const f = await fixtures(t), rule = await f.rule();
	const [slot] = await occurrences(rule.id);
	assert.ok((await deleteTourSlot(slot.id)).ok); // Deleting an occurrence also records the exception.
	for (let i = 0; i < 2; i++) {
		assert.ok(!(await occurrences(rule.id)).some(s => s.date === slot.date));
		assert.ok(!(await familyTourView(f.families[0])).slots.some(s => s.id === slot.id));
		await listAdminTours(); await websiteTourSlots();
	}
	assert.ok((await listTourRules()).find(r => r.id === rule.id).skipDates.includes(slot.date));
	assert.ok((await skipTourRuleDate(rule.id, slot.date, true)).ok);
	assert.ok((await occurrences(rule.id)).some(s => s.date === slot.date));
});

dbtest('edits update only unbooked future occurrences, preserving booked dates and past rows', async t => {
	const f = await fixtures(t), rule = await f.rule();
	const [booked, unbooked] = await occurrences(rule.id);
	assert.ok((await f.book(booked.id, undefined, 4)).ok);
	const pastId = randomUUID();
	await db()`insert into tour_slots (id, rule_id, slot_date, start_time, end_time, capacity) values (${pastId}, ${rule.id}, ${addDays(today, -1)}, '04:10', '04:50', 1)`;
	assert.ok((await saveTourRule({ ...rule, capacity: 7, capacityUnit: 'people', type: 'info_night', published: false })).ok);
	let all = await occurrences(rule.id);
	assert.equal(all.find(s => s.id === booked.id).capacity, 1);
	assert.equal(all.find(s => s.id === booked.id).capacityUnit, 'families');
	assert.equal(all.find(s => s.id === booked.id).published, true);
	assert.equal(all.find(s => s.id === unbooked.id).capacity, 7);
	assert.equal(all.find(s => s.id === unbooked.id).capacityUnit, 'people');
	assert.equal(all.find(s => s.id === unbooked.id).type, 'info_night');
	assert.equal(all.find(s => s.id === unbooked.id).published, false);
	assert.equal(all.find(s => s.id === pastId).capacity, 1);
	// A moved schedule leaves the booked row intact and removes the old unbooked time.
	assert.ok((await saveTourRule({ ...rule, start: '04:12', end: '04:52' })).ok);
	all = await occurrences(rule.id);
	assert.equal(all.find(s => s.id === booked.id).start, '04:10');
	assert.ok(!all.some(s => s.id === unbooked.id));
	assert.ok(all.some(s => s.start === '04:12'));
});

dbtest('skip cancels booked holds; deleting a rule cancels future bookings and keeps the past', async t => {
	const f = await fixtures(t), rule = await f.rule();
	const [first, second] = await occurrences(rule.id);
	assert.ok((await f.book(first.id)).ok);
	assert.ok((await skipTourRuleDate(rule.id, first.date)).ok);
	assert.equal((await db()`select status from tour_holds where family_id = ${f.families[0]}`)[0].status, 'cancelled');
	assert.ok((await f.book(second.id, f.families[1])).ok);
	const past = randomUUID();
	await db()`insert into tour_slots (id, rule_id, slot_date, start_time, end_time) values (${past}, ${rule.id}, ${addDays(today, -1)}, '04:10', '04:50')`;
	await db()`insert into tour_holds (id, family_id, slot_id, kind, status) values (${randomUUID()}, ${f.families[2]}, ${past}, 'slot', 'confirmed')`;
	t.after(async () => { await db()`delete from tour_slots where id = ${past}`; });
	assert.ok((await deleteTourRule(rule.id)).ok);
	assert.equal((await db()`select status, slot_id from tour_holds where family_id = ${f.families[1]}`)[0].status, 'cancelled');
	const [kept] = await db()`select rule_id from tour_slots where id = ${past}`;
	assert.equal(kept.rule_id, null);
	assert.equal((await db()`select status from tour_holds where slot_id = ${past}`)[0].status, 'confirmed');
	assert.equal((await occurrences(rule.id)).length, 0);
});

dbtest('family capacity blocks a second family, counts distinct families and preserves people capacity', async t => {
	const f = await fixtures(t), slot = await f.slot();
	assert.ok((await f.book(slot.id)).ok);
	assert.equal((await f.book(slot.id, f.families[1])).ok, false);
	let other = (await familyTourView(f.families[1])).slots.find(s => s.id === slot.id);
	assert.deepEqual([other.taken, other.spots, other.unavailable], [1,0,true]);
	// A head count of six still consumes one family unit.
	assert.ok((await f.book(slot.id, undefined, 6)).ok);
	await db()`insert into tour_holds (id, family_id, slot_id, kind) values (${randomUUID()}, ${f.families[0]}, ${slot.id}, 'slot')`;
	assert.equal((await listTourSlotSummary()).find(s => s.id === slot.id).taken, 1);
	const people = await f.slot({ start: '03:01', end: '03:31', capacity: 3, capacityUnit: 'people' });
	assert.ok((await f.book(people.id, undefined, 2)).ok);
	assert.equal((await f.book(people.id, f.families[1], 2)).ok, false);
	assert.ok((await f.book(people.id, f.families[1], 1)).ok);
	assert.equal((await listTourSlotSummary()).find(s => s.id === people.id).taken, 3);
});

dbtest('deleted one-offs stay deleted through admin, family and website reads', async t => {
	const f = await fixtures(t), slot = await f.slot();
	assert.ok((await deleteTourSlot(slot.id)).ok);
	await listAdminTours();
	assert.ok(!(await listTourSlotSummary()).some(s => s.id === slot.id));
	assert.ok(!(await familyTourView(f.families[0])).slots.some(s => s.id === slot.id));
	assert.ok(!(await websiteTourSlots()).slots.some(s => s.when.includes('3:00 AM')));
	assert.equal((await db()`select id from tour_slots where id = ${slot.id}`).length, 0);
});

dbtest('confirmed requests create a one-family time regardless of head count', async t => {
	const f = await fixtures(t), id = randomUUID();
	await db()`insert into tour_holds (id, family_id, kind, head_count, email) values (${id}, ${f.families[0]}, 'other', 6, ${f.families[0] + '@example.com'})`;
	const date = addDays(today, 2);
	assert.ok((await replyToTourRequest({ id, date, start: '02:00', end: '02:30', mode: 'confirmed', message: '' })).ok);
	const [slot] = await db()`select s.* from tour_slots s join tour_holds h on h.slot_id = s.id where h.id = ${id}`;
	t.after(async () => { await db()`delete from tour_slots where id = ${slot.id}`; });
	assert.equal(slot.capacity, 1); assert.equal(slot.capacity_unit, 'families');
	assert.equal((await f.book(String(slot.id), f.families[1])).ok, false);
});

dbtest('confirmed replies and accepted proposals cannot overbook an existing family time', async t => {
	const f = await fixtures(t), slot = await f.slot();
	assert.ok((await f.book(slot.id)).ok);
	const id = randomUUID();
	await db()`insert into tour_holds (id, family_id, kind, status, head_count, proposed_date, proposed_start, proposed_end)
		values (${id}, ${f.families[1]}, 'other', 'proposed', 1, ${slot.date}, ${slot.start}, ${slot.end})`;
	assert.equal((await replyToTourRequest({ id, date: slot.date, start: slot.start, end: slot.end, mode: 'confirmed', message: '' })).ok, false);
	assert.equal((await acceptProposedHold(id, f.families[1])).ok, false);
	assert.equal((await db()`select kind from tour_holds where id = ${id}`)[0].kind, 'other');
	assert.equal((await listTourSlotSummary()).find(s => s.id === slot.id).families, 1);
});

dbtest('public API returns the rule summary and only the next three open published future dates', async t => {
	const f = await fixtures(t);
	const oldSlots = await db()`select id from tour_slots where published`;
	const oldRules = await db()`select id from tour_slot_rules where published`;
	await db()`update tour_slots set published = false`; await db()`update tour_slot_rules set published = false`;
	t.after(async () => {
		await db()`update tour_slots set published = true where id = any(${oldSlots.map(s => s.id)}::uuid[])`;
		await db()`update tour_slot_rules set published = true where id = any(${oldRules.map(s => s.id)}::uuid[])`;
	});
	const rule = await f.rule({ start: '08:10', end: '09:00' });
	await f.rule({ start: '08:11', end: '09:01', weekdays: [5] });
	await f.rule({ start: '08:12', end: '09:02', weekdays: [1], published: false });
	const [full] = await occurrences(rule.id); assert.ok((await f.book(full.id)).ok);
	await f.slot({ date: addDays(today, -1) });
	const oneOff = await f.slot({ date: today });
	await f.slot({ date: today, start: '03:01', end: '03:31', published: false });
	const response = await handleAdmissionsRequest(new Request('http://localhost/api/tour-slots'));
	assert.equal(response.status, 200);
	const body = await response.json();
	assert.deepEqual(body.summary, { when: 'Wednesdays & Thursdays & Fridays', time: '8:10 to 9:00 AM', note: TOUR_NOTE });
	assert.equal(body.slots.length, 3); assert.ok(body.slots.every(s => s.open && s.type && s.when));
	assert.equal(body.slots[0].when, (await listTourSlotSummary()).find(s => s.id === oneOff.id).when);
	assert.ok(!body.slots.some(s => s.when === full.when));
	const expected = (await listTourSlotSummary()).filter(s => s.published && s.date >= today && s.taken < s.capacity).slice(0,3).map(s => s.when);
	assert.deepEqual(body.slots.map(s => s.when), expected);
	await db()`update tour_slot_rules set published = false`;
	assert.equal((await websiteTourSlots()).summary, null);
});

dbtest('weekly validation requires weekdays, valid dates, a later end and at most one year', async t => {
	await fixtures(t);
	const input = { weekdays: [], start: '08:10', end: '09:00', startsOn: today, endsOn: addDays(today, 7), capacity: 1, capacityUnit: 'families', published: false };
	assert.ok((await saveTourRule(input)).fields.weekdays);
	assert.ok((await saveTourRule({ ...input, weekdays: [3], endsOn: today })).fields.endsOn);
	assert.ok((await saveTourRule({ ...input, weekdays: [3], endsOn: addDays(today, 367) })).fields.endsOn);
	assert.ok((await saveTourRule({ ...input, weekdays: [3], startsOn: '2027-02-30' })).fields.startsOn);
});

dbtest('the migration seeds exactly once, and deleting it survives cold dbReady and all list calls', async () => {
	// A separate LOCAL database proves dbReady behavior without resetting other tests' data.
	const url = new URL(process.env.DATABASE_URL);
	assert.ok(['127.0.0.1','localhost'].includes(url.hostname));
	const name = 'tour_seed_' + randomUUID().replaceAll('-', '');
	const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
	try {
		await sql.unsafe(`create database ${name}`); url.pathname = '/' + name;
		const source = `
		import assert from 'node:assert/strict';
		import {db, dbReady, listTourRules, deleteTourRule, listTourSlotSummary, listAdminTours, familyTourView} from '@tca/school';
		try {
		 await dbReady(); const rules=await listTourRules();
		 if (process.env.SEED_PHASE === 'delete') {
		  assert.equal(rules.length,1); const r=rules[0];
		  assert.deepEqual(r.weekdays,[3,4]); assert.equal(r.start,'08:10'); assert.equal(r.end,'09:00');
		  assert.equal(r.startsOn,'2026-12-02'); assert.equal(r.endsOn,'2027-05-27');
		  assert.equal(r.capacity,1); assert.equal(r.capacityUnit,'families'); assert.equal(r.published,false);
		  assert.ok((await deleteTourRule(r.id)).ok);
		  await db()\`update settings set value='"stale"'::jsonb where key='schema_version'\`;
		 }
		 await dbReady(); await listTourSlotSummary(); await listAdminTours();
		 await familyTourView('00000000-0000-0000-0000-000000000001');
		 assert.equal((await listTourRules()).length,0);
		 assert.equal((await db()\`select value from settings where key='tour_rule_seed_v1'\`)[0].value,true);
		} finally {await db().end();}`;
		for (const phase of ['delete','cold']) await promisify(execFile)(process.execPath, ['--input-type=module','-e',source], {
			env: { ...process.env, DATABASE_URL: url.href, RESEND_API_KEY: '', SCHOOL_NOTIFY_WEBHOOK_URL: '', SEED_PHASE: phase },
		});
	} finally { await sql.unsafe(`drop database if exists ${name}`); await sql.end(); }
});
