import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { INFO_NIGHT_ID, INFO_NIGHT_SEED_SQL } from '../packages/school/src/schema.ts';
import { inquiryAutoReply, interviewInput } from '@tca/school';

const event = { id: INFO_NIGHT_ID, title: 'Information & Enrollment Night', startsAt: '2027-01-27T00:30:00Z', location: 'Trinity Presbyterian Church, 7160 Cahaba Valley Rd., Birmingham, AL 35242', rsvpUrl: '' };
const origin = 'https://portal.example.com';
// Close the pool so this file exits as soon as its tests finish, even after a failure.
after(async () => { if (process.env.DATABASE_URL) { const { db } = await import('@tca/school'); await db().end({ timeout: 1 }); } });
// A hung send fails the test instead of hanging the run.
const within = (promise, ms = 5000) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`still waiting after ${ms} ms: is a send holding the database connection?`)), ms).unref())]);

const closing = "We will open enrollment and begin interviews no later than January, and we'll follow up then with scheduling details.\n\nTrinity Classical Academy\n";

test('automatic reply exact text, next event, and blank name', () => {
	assert.deepEqual(inquiryAutoReply({ firstName: ' Alex ', event, portalOrigin: origin }), {
		subject: 'Thanks for your interest in Trinity Classical Academy',
		text: "Hi Alex,\n\nThank you for your interest in Trinity Classical Academy. We received your request.\n\nPlease join us for our Information & Enrollment Night on Tuesday, January 26 at 6:30 pm at Trinity Presbyterian Church, 7160 Cahaba Valley Rd., Birmingham, AL 35242. RSVP (optional): https://portal.example.com/rsvp/" + INFO_NIGHT_ID + '\n\n' + closing,
	});
	assert.equal(inquiryAutoReply({ firstName: ' ', portalOrigin: origin }).text, 'Hi there,\n\nThank you for your interest in Trinity Classical Academy. We received your request.\n\n' + closing);
	assert.ok(inquiryAutoReply({ firstName: 'Alex', event: { ...event, rsvpUrl: 'https://example.com/rsvp' }, portalOrigin: origin }).text.includes('RSVP (optional): https://example.com/rsvp'));
});

function interviewForm() {
	const form = new FormData();
	for (const [key, value] of Object.entries({ firstName: 'Alex', lastName: 'Example', email: 'alex@example.com', phone: '2055550101', year: '2027-2028', 'child.0.name': 'Jamie Example', 'child.0.currentGrade': 'Kindergarten', 'child.0.dateOfBirth': '2021-05-12', 'child.0.school': 'Example School', 'child.0.description': 'Loves reading', 'child.1.name': 'Robin Example', 'child.1.currentGrade': '3rd grade', 'answer.church': 'Example Church' })) form.set(key, value);
	return form;
}

test('interview parser requires contact and children, ignores blank extras, maps grades', () => {
	const form = interviewForm();
	const parsed = interviewInput(form);
	assert.equal(parsed.ok, true);
	assert.deepEqual(parsed.input.grades, ['K', '3']);
	assert.equal(parsed.input.details.children.length, 2);
	assert.equal(parsed.input.details.answers.church, 'Example Church');
	form.set('phone', '');
	assert.equal(interviewInput(form).ok, false);
	form.set('phone', '2055550101');
	form.set('child.2.description', 'Missing name');
	assert.equal(interviewInput(form).ok, false);
});

test('legacy guest rows remain valid; featured events expire', async (t) => {
	if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is not set');
	const { db, dbReady, featuredEvent, websiteEvents, guestRsvpEvent, eventRsvpTotals } = await import('@tca/school');
	await dbReady();
	const ids = Array.from({ length: 5 }, () => randomUUID());
	const oldFlags = await db()`select id from events where feature_popup`;
	try {
		await db()`update events set feature_popup = false`;
		await db()`insert into events (id, title, starts_at, ends_at, feature_popup, collect_rsvp, show_on_website) values
			(${ids[0]}, 'Expired with no end', now() - interval '4 hours', null, true, true, true),
			(${ids[1]}, 'Expired with end', now() - interval '2 hours', now() - interval '1 hour', true, true, true),
			(${ids[2]}, 'Open with no end', now() - interval '1 hour', null, true, true, true),
			(${ids[3]}, 'Open with end', now() + interval '1 hour', now() + interval '2 hours', true, true, true),
			(${ids[4]}, 'No RSVPs', now() + interval '1 hour', null, false, false, true)`;
		assert.equal((await featuredEvent()).id, ids[2]);
		assert.ok((await featuredEvent()).rsvpUrl.endsWith(`/rsvp/${ids[2]}`));
		const website = await websiteEvents();
		assert.ok(!website.some((row) => ids.slice(0, 2).includes(row.id)));
		assert.ok(website.find((row) => row.id === ids[3]).rsvpUrl.endsWith(ids[3]));
		await db()`insert into event_guest_rsvps (id, event_id, name, email, head_count, note)
			values (${randomUUID()}, ${ids[2]}, 'Guest Example', 'guest@example.com', 4, 'Legacy note')`;
		assert.equal((await eventRsvpTotals()).find((row) => row.id === ids[2]).heads, 4);
		assert.equal(await guestRsvpEvent('bad'), null);
		await db()`update events set collect_rsvp = false where id = ${ids[2]}`;
		assert.equal((await guestRsvpEvent(ids[2])).open, false);
		assert.equal((await featuredEvent()).rsvpUrl, '');
		await db()`update events set ends_at = now() - interval '1 minute' where id = ${ids[2]}`;
		assert.equal((await featuredEvent()).id, ids[3]);
	} finally {
		await db()`delete from events where id in ${db()(ids)}`;
		for (const row of oldFlags) await db()`update events set feature_popup = true where id = ${row.id}`;
	}
});

test('guarded seed preserves edits and never recreates a deleted event', async (t) => {
	if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is not set');
	const { db, dbReady } = await import('@tca/school');
	await dbReady();
	// Roll back all test changes, including the marker, after checking repeated bootstraps.
	const rollback = new Error('rollback fixture');
	await assert.rejects(db().begin(async (tx) => {
		await tx`delete from events where id = ${INFO_NIGHT_ID}`;
		await tx`delete from settings where key = 'seed:info-night-2027-01-26'`;
		await tx.unsafe(INFO_NIGHT_SEED_SQL);
		assert.equal((await tx`select title from events where id = ${INFO_NIGHT_ID}`)[0].title, event.title);
		await tx`update events set title = 'Staff edited' where id = ${INFO_NIGHT_ID}`;
		await tx.unsafe(INFO_NIGHT_SEED_SQL);
		assert.equal((await tx`select title from events where id = ${INFO_NIGHT_ID}`)[0].title, 'Staff edited');
		await tx`delete from events where id = ${INFO_NIGHT_ID}`;
		await tx.unsafe(INFO_NIGHT_SEED_SQL);
		assert.equal((await tx`select id from events where id = ${INFO_NIGHT_ID}`).length, 0);
		throw rollback;
	}), (error) => error === rollback);
});

// A deadlocked send fails at the timeout; the after hook then closes the pool so the file still exits.
test('interview details are jsonb objects; autoreply defaults off, sends once, kill switch wins', { timeout: 20000 }, async (t) => {
	if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is not set');
	const { db, dbReady, createInquiry, writeSetting, sendInquiryAutoReply, inquiryAutoReplyEnabled, nextInquiryEvent, inquiriesCsv, listInquiries } = await import('@tca/school');
	await dbReady();
	const savedEnv = process.env.INQUIRY_AUTOREPLY;
	const [setting] = await db()`select value from settings where key = 'inquiry_autoreply_enabled'`;
	let calls = [];
	const deliver = async (input) => { calls.push(input); return { delivered: true }; };
	const ids = [];
	try {
		delete process.env.INQUIRY_AUTOREPLY;
		await db()`delete from settings where key = 'inquiry_autoreply_enabled'`;
		assert.equal(await inquiryAutoReplyEnabled(), false);
		const parsed = interviewInput(interviewForm());
		const saved = await createInquiry({ ...parsed.input, notify: false });
		assert.equal(saved.ok, true);
		ids.push(saved.id);
		const [row] = await db()`select details, jsonb_typeof(details) as type, autoreply_sent_at from inquiries where id = ${saved.id}`;
		assert.equal(row.type, 'object');
		assert.equal(row.details.children[1].name, 'Robin Example');
		await sendInquiryAutoReply(saved.id, deliver);
		assert.equal(calls.length, 0);
		assert.equal(row.autoreply_sent_at, null);
		await writeSetting('inquiry_autoreply_enabled', true);
		process.env.INQUIRY_AUTOREPLY = 'off';
		await sendInquiryAutoReply(saved.id, deliver);
		assert.equal(calls.length, 0);
		assert.equal((await db()`select autoreply_sent_at from inquiries where id = ${saved.id}`)[0].autoreply_sent_at, null);
		delete process.env.INQUIRY_AUTOREPLY;
		await Promise.all([sendInquiryAutoReply(saved.id, deliver), sendInquiryAutoReply(saved.id, deliver)]);
		assert.equal(calls.length, 1);
		assert.match(calls[0].replyTo, /@/);
		assert.match(calls[0].text, /^Hi Alex,/);
		assert.ok((await db()`select autoreply_sent_at from inquiries where id = ${saved.id}`)[0].autoreply_sent_at);
		assert.match(await inquiriesCsv(await listInquiries()).text(), /Robin Example/);
		process.env.INQUIRY_AUTOREPLY = 'off';
		const admin = await createInquiry({ ...parsed.input, source: 'admin', notify: false });
		ids.push(admin.id);
		delete process.env.INQUIRY_AUTOREPLY;
		await sendInquiryAutoReply(admin.id, deliver);
		assert.equal(calls.length, 1);
		assert.ok((await nextInquiryEvent())?.id);
	} finally {
		await db()`delete from inquiries where id in ${db()(ids)}`;
		if (setting) await writeSetting('inquiry_autoreply_enabled', setting.value);
		else await db()`delete from settings where key = 'inquiry_autoreply_enabled'`;
		if (savedEnv === undefined) delete process.env.INQUIRY_AUTOREPLY;
		else process.env.INQUIRY_AUTOREPLY = savedEnv;
	}
});

test('autoreply sends outside a transaction, so a send that uses the database cannot hang; a failed send can retry', { timeout: 20000 }, async (t) => {
	if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is not set');
	const { db, dbReady, createInquiry, writeSetting, sendInquiryAutoReply } = await import('@tca/school');
	await dbReady();
	const savedEnv = process.env.INQUIRY_AUTOREPLY;
	const [setting] = await db()`select value from settings where key = 'inquiry_autoreply_enabled'`;
	const sentAt = async (id) => (await db()`select autoreply_sent_at from inquiries where id = ${id}`)[0].autoreply_sent_at;
	// Like the real sendEmail, which checks for duplicates and logs through the same database connection.
	const sends = [];
	const usesDb = (outcome) => async (input) => { await db()`select 1`; sends.push(input); if (outcome === 'throw') throw new Error('provider down'); return { delivered: outcome === 'delivered' }; };
	const ids = [];
	try {
		delete process.env.INQUIRY_AUTOREPLY;
		await writeSetting('inquiry_autoreply_enabled', false);
		const saved = await createInquiry({ ...interviewInput(interviewForm()).input, notify: false });
		ids.push(saved.id);
		await writeSetting('inquiry_autoreply_enabled', true);
		await within(sendInquiryAutoReply(saved.id, usesDb('not-delivered')));
		assert.equal(await sentAt(saved.id), null, 'an undelivered reply is not marked sent');
		await assert.rejects(within(sendInquiryAutoReply(saved.id, usesDb('throw'))), /provider down/);
		assert.equal(await sentAt(saved.id), null, 'a failed send clears the claim');
		await within(Promise.all([sendInquiryAutoReply(saved.id, usesDb('delivered')), sendInquiryAutoReply(saved.id, usesDb('delivered'))]));
		assert.ok(await sentAt(saved.id));
		assert.equal(sends.length, 3, 'two failed attempts, then one delivered reply');
	} finally {
		await db()`delete from inquiries where id in ${db()(ids)}`;
		if (setting) await writeSetting('inquiry_autoreply_enabled', setting.value);
		else await db()`delete from settings where key = 'inquiry_autoreply_enabled'`;
		if (savedEnv === undefined) delete process.env.INQUIRY_AUTOREPLY;
		else process.env.INQUIRY_AUTOREPLY = savedEnv;
	}
});
