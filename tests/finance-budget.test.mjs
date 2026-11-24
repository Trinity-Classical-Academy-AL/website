import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	computeBudget, budgetStatementRows, budgetCompareRows, describeBudgetRule, parseBudgetMoney, parseBudgetRate,
	formatBudgetMoney, growByBps, budgetFacultyCount,
} from '../packages/school/src/finance/compute.ts';

// The AYE 2027 low-census budget, shaped like the proforma sheet (Step 3), with made-up
// staff names and individual pay. Only the sheet's totals are real: faculty $199,625, leadership $15,000.
const line = (section, label, rule, values = {}) => ({ section, kind: null, label, rule, amountCents: 0, rateBps: 0, count: 0, tierId: null, note: '', ...values });
const lowCensus = () => ({
	tiers: [{ id: 'half', label: '½ day K–4th', tuitionCents: 745000, students: 22 }, { id: 'full', label: '5th–8th', tuitionCents: 855000, students: 21 }],
	fees: [{ label: 'Registration', amountCents: 35000, students: null }],
	staff: [
		...Array.from({ length: 8 }, (_, index) => ({ name: `Teacher ${index + 1}`, group: 'faculty', role: '', payCents: 2200000, onPayroll: true })),
		{ name: 'Teacher 9', group: 'faculty', role: '', payCents: 2362500, onPayroll: true },
		{ name: 'Head of school', group: 'leadership', role: 'HOS', payCents: 0, onPayroll: true },
		{ name: 'Office A', group: 'leadership', role: '', payCents: 1000000, onPayroll: true },
		{ name: 'Office B', group: 'leadership', role: '', payCents: 500000, onPayroll: true },
	],
	lines: [
		line('discounts', 'Faculty discount', 'pct_tuition_count', { kind: 'faculty', rateBps: 2500, count: 9, tierId: 'half' }),
		line('discounts', 'Church savings', 'flat', { kind: 'family', amountCents: 1040000 }),
		line('discounts', 'TPC member discount', 'flat', { kind: 'family', amountCents: 800000 }),
		line('discounts', 'Tuition assistance', 'flat', { kind: 'assistance', amountCents: 2390000 }),
		...[['Rent', 6650000], ["Workmen's comp", 80000], ['Internet', 60000], ['Marketing', 350000], ['Cleaning', 720000], ['Training', 500000], ['CLT', 150000], ['Events', 300000], ['Membership', 25000], ['Payroll service', 43200]]
			.map(([label, cents]) => line('fixed', label, 'flat', { amountCents: cents })),
		line('education', 'Classroom supplies', 'per_student', { amountCents: 10000 }),
		line('education', 'Amount per faculty member', 'per_faculty', { amountCents: 10000 }),
		line('education', 'Curriculum', 'per_student', { amountCents: 35000 }),
		line('education', 'CHOOSE Act savings', 'per_student', { amountCents: 100000 }),
		line('administrative', 'Printer', 'per_student', { amountCents: 3500 }),
		line('administrative', 'Office supplies', 'per_student', { amountCents: 3500 }),
		line('administrative', 'Concordis', 'per_student_monthly', { amountCents: 5000 }),
		line('administrative', 'Bank processing fees', 'pct_collected', { rateBps: 200 }),
		line('facility', 'Janitorial supplies', 'per_student', { amountCents: 3500 }),
		line('facility', 'Furnishings', 'per_student', { amountCents: 10000 }),
		line('facility', 'Repair and maintenance', 'per_student', { amountCents: 2500 }),
	],
	settings: { subRateBps: 150, payrollTaxBps: 800, medicalCents: 0, retirementCents: 0, churchDonationCents: 10000000 },
});

test('budget: the low-census statement matches the sheet, with 9 faculty instead of 24', () => {
	const s = computeBudget(lowCensus());
	assert.equal(s.census, 43);
	assert.equal(s.facultyCount, 9, 'faculty on payroll with pay');
	assert.equal(s.revenue.tuition.amount, 34345000);
	assert.equal(s.revenue.fees_total.amount, 1505000);
	assert.equal(s.revenue.gross.amount, 35850000);
	assert.equal(s.discounts.lines[0].amount, 1676250, '25% × $7,450 × 9');
	assert.equal(s.discounts.total.amount, 5906250);
	assert.equal(s.netRevenue.amount, 29943750);
	assert.equal(s.personnel.faculty.amount, 19962500);
	assert.equal(s.personnel.leadership.amount, 1500000);
	assert.equal(s.personnel.substitutes.amount, 299438, '1.5% of faculty, rounded once');
	assert.equal(s.personnel.payrollTax.amount, 1740955, '8% of pay including substitutes (sheet: 17,409.55)');
	assert.equal(s.personnel.total.amount, 23502893);
	assert.equal(s.fixed.total.amount, 8878200);
	assert.equal(s.variable.education.total.amount, 6325000, 'sheet 64,750 less 1,500 from the faculty count');
	assert.equal(s.variable.administrative.lines.at(-1).amount, 635675, '2% of (gross − faculty − assistance)');
	assert.equal(s.variable.administrative.total.amount, 3516675);
	assert.equal(s.variable.facility.total.amount, 688000);
	assert.equal(s.totalExpenses.amount, 42910768);
	assert.equal(s.net.amount, -12967018);
	assert.equal(s.final.amount, -2967018, 'sheet −31,170.18 + 1,500');
	assert.ok(Math.abs(s.revenue.gross.pctGross - 1) < 1e-9);
	// Every subtotal is the sum of the rounded lines shown.
	for (const group of [s.discounts, s.fixed, s.variable.education, s.variable.administrative, s.variable.facility]) {
		assert.equal(group.total.amount, group.lines.reduce((sum, item) => sum + item.amount, 0));
	}
});

test('budget: rules', () => {
	const input = lowCensus();
	input.lines = [
		line('fixed', 'Pct gross', 'pct_gross', { rateBps: 100 }),
		line('fixed', 'Pct tuition', 'pct_tuition', { rateBps: 1000 }),
		line('discounts', 'Avg tier', 'pct_tuition_count', { kind: 'faculty', rateBps: 5000, count: 2, tierId: 'missing' }),
		line('discounts', 'Collected discount', 'pct_collected', { kind: 'other', rateBps: 1000 }),
	];
	input.staff.push({ name: 'Contractor', group: 'faculty', role: '', payCents: 100000, onPayroll: false });
	const s = computeBudget(input);
	assert.equal(s.fixed.lines[0].amount, 358500);
	assert.equal(s.fixed.lines[1].amount, 3434500);
	const average = Math.round(34345000 / 43);
	assert.equal(s.discounts.lines[0].amount, Math.round(average * 2 / 2), 'unknown tier falls back to average tuition');
	assert.equal(s.discounts.lines[1].amount, Math.round((35850000 - s.discounts.lines[0].amount) / 10));
	assert.equal(budgetFacultyCount(input.staff), 9, 'off-payroll faculty are not counted');
	assert.equal(s.personnel.payrollTax.amount, Math.round((21462500 + s.personnel.substitutes.amount) * 0.08), 'off-payroll pay is not taxed');
	assert.equal(describeBudgetRule(input.lines[1], { census: 43, facultyCount: 9, tiers: input.tiers }), '10% of tuition');
});

test('budget: empty scenario, display rows and compare rows', () => {
	const s = computeBudget({ tiers: [], fees: [], staff: [], lines: [], settings: { subRateBps: 150, payrollTaxBps: 800, medicalCents: 0, retirementCents: 0, churchDonationCents: 0 } });
	assert.equal(s.final.amount, 0);
	assert.equal(s.net.pctGross, null);
	const rows = budgetStatementRows(computeBudget(lowCensus()));
	assert.equal(rows[0].type, 'head');
	assert.equal(rows.at(-1).label, 'Final budget');
	assert.equal(budgetCompareRows(s).length, 11);
});

test('budget: money and rate parsing', () => {
	assert.equal(parseBudgetMoney('$7,450.5'), 745050);
	assert.equal(parseBudgetMoney(''), 0);
	assert.equal(parseBudgetMoney('abc'), null);
	assert.equal(parseBudgetMoney('1.234'), null);
	assert.equal(parseBudgetRate('1.5%'), 150);
	assert.equal(parseBudgetRate('x'), null);
	assert.equal(formatBudgetMoney(-2967018), '($29,670.18)');
	assert.equal(formatBudgetMoney(745000), '$7,450');
	assert.equal(growByBps(2925000, 300), 3012750);
});
