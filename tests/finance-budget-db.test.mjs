import { test } from 'node:test';
import assert from 'node:assert/strict';

test('budget db: scenarios, items, rates, duplicate and import', async (t) => {
	if (!process.env.DATABASE_URL) {
		t.skip('DATABASE_URL is not set');
		return;
	}
	const school = await import('@tca/school');
	const { db, dbReady, createScenario, updateScenario, getScenario, listScenarios, primaryScenario, scenarioRates, saveTier, saveFee, saveStaff, saveLine,
		saveStaffSettings, deleteBudgetItem, duplicateScenario, writeScenarios, deleteScenario, computeBudget, scenarioInput, budgetDiscountKinds } = school;
	await dbReady();
	const stamp = Date.now();
	const year = `29${String(stamp).slice(-2)}–${String(Number(String(stamp).slice(-2)) + 1).padStart(2, '0').slice(-2)}`;
	const name = (label) => `Test ${label} ${stamp}`;
	const made = [];
	try {
		assert.deepEqual([...budgetDiscountKinds], ['faculty', 'family', 'assistance', 'other']);
		const created = await createScenario({ name: name('base'), schoolYear: year });
		assert.equal(created.ok, true);
		made.push(created.id);
		assert.equal((await createScenario({ name: name('base').toUpperCase(), schoolYear: year })).ok, false, 'names are unique');
		assert.equal((await createScenario({ name: 'x', schoolYear: 'next year' })).ok, false, 'school year is checked');
		assert.deepEqual(await primaryScenario(year), { id: created.id, name: name('base') }, 'the first budget of a year is primary');

		const tier = await saveTier({ scenarioId: created.id, label: 'K–4', tuitionCents: 700000, students: 10 });
		await saveTier({ scenarioId: created.id, label: '5–8', tuitionCents: 800000, students: 5 });
		await saveFee({ scenarioId: created.id, label: 'Registration', amountCents: 35000, students: null });
		await saveStaff({ scenarioId: created.id, name: 'Teacher A', group: 'faculty', role: '', payCents: 3000000, onPayroll: true });
		const contractor = await saveStaff({ scenarioId: created.id, name: 'Contractor', group: 'faculty', role: 'Art', payCents: 500000, onPayroll: false });
		assert.equal((await saveStaff({ scenarioId: created.id, name: '', group: 'teacher', role: '', payCents: 1, onPayroll: true })).ok, false);
		await saveLine({ scenarioId: created.id, section: 'discounts', kind: 'faculty', label: 'Faculty discount', rule: 'pct_tuition_count', amountCents: 0, rateBps: 2500, count: 2, tierId: tier.id, note: '' });
		const rent = await saveLine({ scenarioId: created.id, section: 'fixed', kind: null, label: 'Rent', rule: 'flat', amountCents: 1000000, rateBps: 0, count: 0, tierId: null, note: 'Lease' });
		await saveLine({ scenarioId: created.id, section: 'administrative', kind: null, label: 'Bank fees', rule: 'pct_collected', amountCents: 0, rateBps: 200, count: 0, tierId: null, note: '' });
		assert.equal((await saveLine({ scenarioId: created.id, section: 'discounts', kind: null, label: 'No kind', rule: 'flat', amountCents: 1, rateBps: 0, count: 0, tierId: null, note: '' })).ok, false, 'discounts need a kind');
		assert.equal((await saveStaffSettings({ id: created.id, subRateBps: 200, payrollTaxBps: 1000, medicalCents: 0, retirementCents: 0 })).ok, true);
		await updateScenario({ id: created.id, name: name('base'), schoolYear: year, notes: 'n', churchDonationCents: 500000, primary: true });

		const scenario = await getScenario(created.id);
		assert.equal(scenario.tiers.length, 2);
		assert.equal(scenario.lines.find((line) => line.label === 'Faculty discount').tierId, tier.id);
		const s = computeBudget(scenarioInput(scenario));
		assert.equal(s.census, 15);
		assert.equal(s.facultyCount, 1, 'the contractor is off payroll');
		assert.equal(s.revenue.gross.amount, 7000000 + 4000000 + 35000 * 15);
		assert.equal(s.discounts.total.amount, 350000, '25% × $7,000 × 2');
		assert.equal(s.personnel.payrollTax.amount, Math.round((3000000 + Math.round(3500000 * 0.02)) * 0.1));
		assert.equal(s.churchDonation.amount, 500000);

		assert.deepEqual(await scenarioRates(created.id), {
			tiers: [{ label: 'K–4', tuitionCents: 700000, students: 10 }, { label: '5–8', tuitionCents: 800000, students: 5 }],
			fees: [{ label: 'Registration', amountCents: 35000 }],
		});
		assert.ok((await listScenarios()).some((item) => item.id === created.id && item.primary && item.schoolYear === year));

		const copy = await duplicateScenario({ id: created.id, name: name('copy'), schoolYear: year, growthBps: 300, growLines: true, growStaff: true, growTuition: false });
		assert.equal(copy.ok, true);
		made.push(copy.id);
		const copied = await getScenario(copy.id);
		assert.equal(copied.primary, false, 'the copy is not primary');
		assert.equal(copied.tiers[0].tuitionCents, 700000, 'tuition not grown');
		assert.equal(copied.staff.find((p) => p.name === 'Teacher A').payCents, 3090000);
		assert.equal(copied.lines.find((l) => l.label === 'Rent').amountCents, 1030000);
		assert.equal(copied.lines.find((l) => l.label === 'Faculty discount').tierId, copied.tiers[0].id, 'the line follows its copied tier');

		assert.equal((await deleteBudgetItem('line', created.id, rent.id)).ok, true);
		assert.equal((await deleteBudgetItem('staff', created.id, contractor.id)).ok, true);
		assert.equal((await getScenario(created.id)).lines.length, 2);

		// Import: refuse an existing name, replace on request.
		const data = { name: name('import'), schoolYear: year, settings: { subRateBps: 150, payrollTaxBps: 800, medicalCents: 0, retirementCents: 0, churchDonationCents: 0 },
			tiers: [{ label: 'All', tuitionCents: 100000, students: 3 }], fees: [], staff: [{ name: 'P', group: 'faculty', payCents: 100 }],
			lines: [{ section: 'discounts', kind: 'faculty', label: 'D', rule: 'pct_tuition_count', rateBps: 1000, count: 1, tierLabel: 'All' }] };
		const first = await writeScenarios([data]);
		assert.equal(first.ok, true);
		made.push(...first.ids);
		assert.equal((await writeScenarios([data])).ok, false);
		const again = await writeScenarios([data], { replace: true });
		assert.equal(again.ok, true);
		made.push(...again.ids);
		assert.equal(await getScenario(first.ids[0]), null, 'replaced');
		assert.equal(computeBudget(scenarioInput(await getScenario(again.ids[0]))).discounts.total.amount, 10000);

		assert.equal((await deleteScenario(created.id)).ok, true);
		assert.equal(await getScenario(created.id), null);
		assert.equal((await db()`select count(*)::int as n from budget_lines where scenario_id = ${created.id}`)[0].n, 0, 'lines go with the scenario');
	} finally {
		if (made.length) await db()`delete from budget_scenarios where id in ${db()(made)}`;
		await db().end();
	}
});
