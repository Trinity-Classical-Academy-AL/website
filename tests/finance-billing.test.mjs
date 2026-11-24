import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	billingBalance, gradesFromTierLabel, installmentDates, installmentCoverage, parseBillingMoney, planLines, splitCents,
	paymentProviders, paymentProvider, onlinePaymentProvider,
} from '@tca/school';

test('billing: schedules, money and tiers (no database)', () => {
	assert.deepEqual(installmentDates('ten_month', '2026-08-01'), ['2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01', '2027-04-01', '2027-05-01']);
	assert.deepEqual(installmentDates('semester', '2026-08-15'), ['2026-08-15', '2027-01-15']);
	assert.equal(installmentDates('twelve_month', '2026-07-01').at(-1), '2027-06-01');
	assert.deepEqual(splitCents(1001, 3), [334, 334, 333]);
	assert.equal(parseBillingMoney('$1,234.5'), 123450);
	assert.equal(parseBillingMoney('abc'), null);
	assert.deepEqual(gradesFromTierLabel('½ day K–4th'), ['K', '1', '2', '3', '4']);
	assert.deepEqual(gradesFromTierLabel('5th–8th'), ['5', '6', '7', '8']);
	const lines = planLines({ schoolYear: '2026–27', tuitionCents: 745000, schedule: 'ten_month', firstDueOn: '2026-08-01', fees: [{ label: 'Registration', amountCents: 25000, dueOn: '2026-07-01' }], discounts: [{ kind: 'assistance', label: 'Aid', pctBps: 1000 }] }, '2026-07-01');
	assert.equal(lines.filter((line) => line.category === 'tuition').reduce((sum, line) => sum + line.amountCents, 0), 745000);
	assert.equal(lines.filter((line) => line.category === 'tuition_assistance').reduce((sum, line) => sum + line.amountCents, 0), 74500);
	assert.equal(lines.find((line) => line.category === 'registration').amountCents, 25000);
});

test('billing: provider registry has only manual, not online', () => {
	assert.deepEqual(paymentProviders.map((provider) => provider.id), ['manual']);
	assert.equal(paymentProvider('manual').online, false);
	assert.equal(paymentProvider('stripe'), null);
	assert.equal(onlinePaymentProvider(), null);
});

test('billing: balance math leaves out voids; due now only counts what is due', () => {
	const entries = [
		{ kind: 'charge', direction: null, amountCents: 1000, dueOn: '2026-08-01', voidedAt: null },
		{ kind: 'charge', direction: null, amountCents: 1000, dueOn: '2026-12-01', voidedAt: null },
		{ kind: 'credit', direction: null, amountCents: 100, dueOn: '2026-08-01', voidedAt: null },
		{ kind: 'payment', direction: null, amountCents: 500, dueOn: null, voidedAt: null },
		{ kind: 'payment', direction: null, amountCents: 9999, dueOn: null, voidedAt: '2026-09-01T00:00:00Z' },
		{ kind: 'refund', direction: null, amountCents: 50, dueOn: null, voidedAt: null },
		{ kind: 'adjustment', direction: 'debit', amountCents: 25, dueOn: '2026-09-01', voidedAt: null },
		{ kind: 'adjustment', direction: 'credit', amountCents: 10, dueOn: '2026-09-01', voidedAt: null },
	];
	const balance = billingBalance(entries, '2026-11-23');
	assert.equal(balance.balanceCents, 1000 + 1000 - 100 - 500 + 50 + 25 - 10);
	assert.equal(balance.dueNowCents, 1000 - 100 - 500 + 50 + 25 - 10);
	assert.equal(balance.paidCents, 450);
	const coverage = installmentCoverage(entries.map((entry) => ({ ...entry, postedOn: entry.dueOn ?? '2026-09-01', scheduled: entry.kind !== 'payment' && entry.kind !== 'refund' && entry.kind !== 'adjustment' })), '2026-11-23');
	assert.equal(coverage[0].status, 'partial');
	assert.equal(coverage.at(-1).status, 'upcoming');
});

test('billing: plans write the ledger; payments, voids and the QuickBooks export', async (t) => {
	if (!process.env.DATABASE_URL) {
		t.skip('DATABASE_URL is not set');
		return;
	}
	const school = await import('@tca/school');
	const { db, dbReady } = school;
	await dbReady();
	const stamp = Date.now();
	const year = `${3000 + (stamp % 900)}–${String(3001 + (stamp % 900)).slice(2)}`;
	const familyId = randomUUID(), childId = randomUUID(), otherChild = randomUUID();
	await db()`insert into families (id, name, email, phone, password_hash, roles) values (${familyId}, ${'Billing Test'}, ${`billing-${stamp}@example.com`}, '', 'hash', ${['guardian']})`;
	await db()`insert into children (id, family_id, kind, name, grade, position) values (${childId}, ${familyId}, 'student', 'Evelyn', '3', 0), (${otherChild}, ${familyId}, 'student', 'Sam', '6', 1)`;
	await db()`insert into enrollments (id, child_id, school_year, grade, status) values (${randomUUID()}, ${childId}, ${year}, '3', 'enrolled'), (${randomUUID()}, ${otherChild}, ${year}, '6', 'enrolled')`;
	try {
		const by = 'finance@example.com';
		const card = await school.saveRateCard({ schoolYear: year, tiers: [{ label: '½ day K–4th', tuitionCents: 745000 }, { label: '5th–8th', tuitionCents: 855000 }], fees: [{ label: 'Registration', amountCents: 25000 }], by });
		assert.ok(card.ok);
		const drafts = await school.createDraftPlans(year, by);
		assert.deepEqual(drafts, { ok: true, created: 2, unmatched: 0 });
		const plans = await school.listPlans(year);
		const evelyn = plans.find((plan) => plan.childId === childId);
		assert.equal(evelyn.tier, '½ day K–4th');
		assert.equal(evelyn.tuitionCents, 745000);
		assert.equal(evelyn.status, 'draft');
		assert.equal((await db()`select count(*)::int as n from finance_entries where family_id = ${familyId}`)[0].n, 0, 'drafts write nothing');

		// Add aid, then activate: scheduled charges and credits land on the ledger.
		const start = Number(year.slice(0, 4));
		const today = `${start}-10-15`;
		assert.ok((await school.savePlan({ ...evelyn, discounts: [{ kind: 'assistance', label: 'Aid award', amountCents: 100000 }] }, by, today)).ok);
		assert.ok((await school.activatePlan(evelyn.id, by, today)).ok);
		const scheduled = await db()`select * from finance_entries where plan_id = ${evelyn.id} and voided_at is null`;
		assert.equal(scheduled.filter((row) => row.category === 'tuition').length, 10);
		assert.equal(scheduled.filter((row) => row.category === 'tuition_assistance').length, 10);
		assert.equal(scheduled.filter((row) => row.category === 'registration').length, 1);
		assert.ok(scheduled.every((row) => row.scheduled));

		let ledger = await school.householdLedger(familyId, year, today);
		assert.equal(ledger.balance.balanceCents, 745000 - 100000 + 25000);
		// Aug, Sep, Oct installments are due, plus the registration fee (dated the activation day).
		assert.equal(ledger.balance.dueNowCents, 3 * 74500 - 3 * 10000 + 25000);

		// A manual payment, and a mistaken one that gets voided.
		assert.ok((await school.recordEntry({ familyId, schoolYear: year, kind: 'payment', amountCents: 50000, method: 'check', reference: '1042', postedOn: today }, by)).ok);
		const wrong = await school.recordEntry({ familyId, schoolYear: year, kind: 'payment', amountCents: 999900, method: 'cash', postedOn: today }, by);
		assert.ok(wrong.ok);
		assert.equal((await school.voidEntry(wrong.id, '', by)).ok, false, 'a void needs a reason');
		assert.ok((await school.voidEntry(wrong.id, 'Typed the wrong amount', by)).ok);
		assert.equal((await school.voidEntry(wrong.id, 'again', by)).ok, false);
		assert.equal((await school.recordEntry({ familyId, schoolYear: year, kind: 'payment', amountCents: 100, postedOn: today }, by)).ok, false, 'a payment needs a method');
		ledger = await school.householdLedger(familyId, year, today);
		assert.equal(ledger.balance.balanceCents, 745000 - 100000 + 25000 - 50000);
		assert.equal(ledger.balance.paidCents, 50000);
		assert.equal(ledger.lines.length, 23);
		assert.equal(ledger.lines.at(-1).runningCents, ledger.balance.balanceCents);
		const activity = await db()`select note from family_activity where family_id = ${familyId} order by at`;
		assert.ok(activity.some((row) => row.note === 'Payment recorded (check 1042)'));
		assert.ok(activity.every((row) => !row.note.includes('$')), 'no amounts in the activity log');

		// Changing the plan replaces only future installments; what was already due becomes one adjustment.
		assert.ok((await school.savePlan({ ...evelyn, tuitionCents: 755000, discounts: [{ kind: 'assistance', label: 'Aid award', amountCents: 100000 }] }, by, today)).ok);
		ledger = await school.householdLedger(familyId, year, today);
		assert.equal(ledger.balance.balanceCents, 755000 - 100000 + 25000 - 50000);
		const adjustment = ledger.lines.find((line) => line.kind === 'adjustment' && !line.voidedAt);
		assert.equal(adjustment.amountCents, 3000);
		assert.equal(adjustment.direction, 'debit');
		assert.equal(ledger.lines.filter((line) => line.voidReason === 'Plan changed').length, 14);

		// Closing voids future scheduled entries only.
		assert.ok((await school.closePlan(evelyn.id, by, today)).ok);
		ledger = await school.householdLedger(familyId, year, today);
		assert.equal(ledger.balance.balanceCents, ledger.balance.dueNowCents);

		// Families list and the QuickBooks export.
		const accounts = await school.listBillingAccounts(year, today);
		const mine = accounts.find((account) => account.familyId === familyId);
		assert.equal(mine.balanceCents, ledger.balance.balanceCents);
		assert.deepEqual(mine.students, ['Sam']);
		const exported = await school.booksExportRows({ from: `${start}-07-01`, to: today });
		const rows = exported.rows.filter((row) => row.customer === 'Billing Test');
		assert.ok(rows.some((row) => row.type === 'Payment' && row.amount === '500.00' && row.reference === '1042' && row.account === 'Undeposited Funds'));
		assert.ok(rows.some((row) => row.type === 'Invoice' && row.category === 'Tuition' && row.account === 'Tuition Income'));
		assert.ok(rows.some((row) => row.type === 'Credit Memo' && row.account === 'Financial Aid'));
		assert.ok(!rows.some((row) => row.amount === '9999.00'), 'voids are not exported');
		assert.match(school.booksExportCsv(rows), /^﻿Date,Transaction Type,Customer/);
		await school.markEntriesExported(rows.map((row) => row.entryId));
		const again = await school.booksExportRows({ from: `${start}-07-01`, to: today, onlyNew: true });
		assert.equal(again.rows.filter((row) => row.customer === 'Billing Test').length, 0);
		const payments = await school.listBillingPayments(`${start}-07-01`, today);
		assert.equal(payments.filter((row) => row.familyId === familyId).length, 2);
	} finally {
		await db()`delete from finance_entries where family_id = ${familyId}`;
		await db()`delete from finance_plans where family_id = ${familyId}`;
		await db()`delete from finance_rate_cards where school_year = ${year}`;
		await db()`delete from families where id = ${familyId}`;
	}
});
