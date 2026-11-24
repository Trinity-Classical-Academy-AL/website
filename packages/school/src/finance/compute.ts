// The budget (proforma) calculation. Pure: no I/O. Money is integer cents, rates are
// basis points (2% = 200). Each line is rounded once, so a total is the sum of what is shown.

export const budgetSections = ['discounts', 'fixed', 'education', 'administrative', 'facility'] as const;
export type BudgetSection = (typeof budgetSections)[number];
export const budgetDiscountKinds = ['faculty', 'family', 'assistance', 'other'] as const;
export type BudgetDiscountKind = (typeof budgetDiscountKinds)[number];
export const budgetRules = ['flat', 'per_student', 'per_student_monthly', 'per_faculty', 'pct_gross', 'pct_tuition', 'pct_collected', 'pct_tuition_count'] as const;
export type BudgetRule = (typeof budgetRules)[number];
export const budgetStaffGroups = ['faculty', 'leadership'] as const;
export type BudgetStaffGroup = (typeof budgetStaffGroups)[number];

export const budgetSectionLabels: Record<BudgetSection, string> = {
	discounts: 'Discounts',
	fixed: 'Fixed expenses',
	education: 'Education program',
	administrative: 'Administrative',
	facility: 'Facility',
};
export const budgetRuleLabels: Record<BudgetRule, string> = {
	flat: 'Flat per year',
	per_student: 'Per student',
	per_student_monthly: 'Per student, monthly',
	per_faculty: 'Per faculty member',
	pct_gross: '% of gross revenue',
	pct_tuition: '% of tuition',
	pct_collected: '% of collected revenue',
	pct_tuition_count: '% of a tier’s tuition × count',
};
export const budgetDiscountKindLabels: Record<BudgetDiscountKind, string> = { faculty: 'Faculty', family: 'Family', assistance: 'Tuition assistance', other: 'Other' };
/** Rules whose input is a rate (basis points) rather than an amount (cents). */
export const budgetRateRules: ReadonlySet<BudgetRule> = new Set(['pct_gross', 'pct_tuition', 'pct_collected', 'pct_tuition_count']);

export type BudgetTier = { id?: string; label: string; tuitionCents: number; students: number };
export type BudgetFee = { id?: string; label: string; amountCents: number; students: number | null };
export type BudgetStaff = { id?: string; name: string; group: BudgetStaffGroup; role: string; payCents: number; onPayroll: boolean };
export type BudgetLine = {
	id?: string;
	section: BudgetSection;
	kind: BudgetDiscountKind | null;
	label: string;
	rule: BudgetRule;
	amountCents: number;
	rateBps: number;
	count: number;
	tierId: string | null;
	note: string;
};
export type BudgetSettings = { subRateBps: number; payrollTaxBps: number; medicalCents: number; retirementCents: number; churchDonationCents: number };
export type BudgetInput = { tiers: BudgetTier[]; fees: BudgetFee[]; staff: BudgetStaff[]; lines: BudgetLine[]; settings: BudgetSettings };

export type BudgetStatementRow = { label: string; amount: number; pctGross: number | null };
export type BudgetStatementLine = BudgetStatementRow & { id?: string; rule: BudgetRule; basis: string; kind: BudgetDiscountKind | null };
export type BudgetStatementGroup = { lines: BudgetStatementLine[]; total: BudgetStatementRow };
export type BudgetStatement = {
	census: number;
	facultyCount: number;
	averageTuitionCents: number;
	revenue: { tiers: (BudgetStatementRow & { basis: string })[]; fees: (BudgetStatementRow & { basis: string })[]; tuition: BudgetStatementRow; fees_total: BudgetStatementRow; gross: BudgetStatementRow };
	discounts: BudgetStatementGroup;
	netRevenue: BudgetStatementRow;
	personnel: { leadership: BudgetStatementRow; faculty: BudgetStatementRow; substitutes: BudgetStatementRow; payrollTax: BudgetStatementRow; medical: BudgetStatementRow; retirement: BudgetStatementRow; total: BudgetStatementRow };
	fixed: BudgetStatementGroup;
	totalFixed: BudgetStatementRow;
	variable: { education: BudgetStatementGroup; administrative: BudgetStatementGroup; facility: BudgetStatementGroup; total: BudgetStatementRow };
	totalExpenses: BudgetStatementRow;
	net: BudgetStatementRow;
	churchDonation: BudgetStatementRow;
	final: BudgetStatementRow;
};

const round = (value: number) => Math.round(value);
const ofBps = (base: number, bps: number) => round((base * bps) / 10000);

export const formatBudgetMoney = (cents: number, options: { sign?: boolean } = {}): string => {
	const negative = cents < 0;
	const abs = Math.abs(cents);
	const whole = Math.floor(abs / 100).toLocaleString('en-US');
	const part = abs % 100;
	const body = `$${whole}${part ? `.${String(part).padStart(2, '0')}` : ''}`;
	return negative ? `(${body})` : options.sign && cents > 0 ? `+${body}` : body;
};
export const formatBudgetRate = (bps: number): string => `${(bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
export const formatBudgetShare = (ratio: number | null): string => ratio === null ? '' : `${(ratio * 100).toFixed(1)}%`;

/** Faculty on payroll with pay above zero: the count behind `per_faculty` lines. */
export const budgetFacultyCount = (staff: BudgetStaff[]) => staff.filter((row) => row.group === 'faculty' && row.onPayroll && row.payCents > 0).length;
export const budgetCensus = (tiers: BudgetTier[]) => tiers.reduce((sum, tier) => sum + tier.students, 0);

/** The rule, written out with this scenario's numbers ("$100 × 43 students"). */
export function describeBudgetRule(line: BudgetLine, context: { census: number; facultyCount: number; tiers: BudgetTier[] }): string {
	const money = formatBudgetMoney(line.amountCents);
	const rate = formatBudgetRate(line.rateBps);
	switch (line.rule) {
		case 'flat': return 'Flat';
		case 'per_student': return `${money} × ${context.census} students`;
		case 'per_student_monthly': return `${money} × ${context.census} students × 12`;
		case 'per_faculty': return `${money} × ${context.facultyCount} faculty`;
		case 'pct_gross': return `${rate} of gross revenue`;
		case 'pct_tuition': return `${rate} of tuition`;
		case 'pct_collected': return `${rate} of gross − faculty discount − assistance`;
		case 'pct_tuition_count': {
			const tier = context.tiers.find((item) => item.id && item.id === line.tierId);
			return `${rate} × ${tier ? `${tier.label} tuition` : 'average tuition'} × ${line.count}`;
		}
	}
}

export function computeBudget(input: BudgetInput): BudgetStatement {
	const census = budgetCensus(input.tiers);
	const faculty = budgetFacultyCount(input.staff);
	const tuition = input.tiers.reduce((sum, tier) => sum + tier.tuitionCents * tier.students, 0);
	const averageTuitionCents = census ? round(tuition / census) : 0;
	const feeAmounts = input.fees.map((fee) => fee.amountCents * (fee.students ?? census));
	const feesTotal = feeAmounts.reduce((sum, value) => sum + value, 0);
	const gross = tuition + feesTotal;
	const pct = (amount: number) => gross ? amount / gross : null;
	const row = (label: string, amount: number): BudgetStatementRow => ({ label, amount, pctGross: pct(amount) });
	const context = { census, facultyCount: faculty, tiers: input.tiers };

	const tierTuition = (line: BudgetLine) => input.tiers.find((tier) => tier.id && tier.id === line.tierId)?.tuitionCents ?? averageTuitionCents;
	// `pct_collected` lines are priced last: their base needs the discounts.
	const amountOf = (line: BudgetLine, collectedBase: number): number => {
		switch (line.rule) {
			case 'flat': return line.amountCents;
			case 'per_student': return line.amountCents * census;
			case 'per_student_monthly': return line.amountCents * census * 12;
			case 'per_faculty': return line.amountCents * faculty;
			case 'pct_gross': return ofBps(gross, line.rateBps);
			case 'pct_tuition': return ofBps(tuition, line.rateBps);
			case 'pct_collected': return ofBps(collectedBase, line.rateBps);
			case 'pct_tuition_count': return ofBps(tierTuition(line) * line.count, line.rateBps);
		}
	};
	const priced = (lines: BudgetLine[], collectedBase: number) => lines.map((line) => ({ line, amount: amountOf(line, collectedBase) }));

	// Discounts first; a pct_collected discount takes its base from the other discounts.
	const discountLines = input.lines.filter((line) => line.section === 'discounts');
	const firstPass = priced(discountLines.filter((line) => line.rule !== 'pct_collected'), 0);
	const kindTotal = (rows: { line: BudgetLine; amount: number }[], kind: BudgetDiscountKind) => rows.filter((item) => (item.line.kind ?? 'other') === kind).reduce((sum, item) => sum + item.amount, 0);
	const preBase = gross - kindTotal(firstPass, 'faculty') - kindTotal(firstPass, 'assistance');
	const discounts = discountLines.map((line) => ({ line, amount: line.rule === 'pct_collected' ? amountOf(line, preBase) : firstPass.find((item) => item.line === line)!.amount }));
	const collectedBase = gross - kindTotal(discounts, 'faculty') - kindTotal(discounts, 'assistance');

	const group = (section: BudgetSection, rows?: { line: BudgetLine; amount: number }[]): BudgetStatementGroup => {
		const items = rows ?? priced(input.lines.filter((line) => line.section === section), collectedBase);
		const lines = items.map(({ line, amount }) => ({ ...row(line.label, amount), id: line.id, rule: line.rule, basis: describeBudgetRule(line, context), kind: line.kind }));
		return { lines, total: row(`Total ${budgetSectionLabels[section].toLowerCase()}`, lines.reduce((sum, item) => sum + item.amount, 0)) };
	};

	const discountGroup = group('discounts', discounts);
	const netRevenue = gross - discountGroup.total.amount;

	const pay = (groupName: BudgetStaffGroup) => input.staff.filter((item) => item.group === groupName).reduce((sum, item) => sum + item.payCents, 0);
	const payrollPay = input.staff.filter((item) => item.onPayroll).reduce((sum, item) => sum + item.payCents, 0);
	const leadership = pay('leadership');
	const facultyPay = pay('faculty');
	const substitutes = ofBps(facultyPay, input.settings.subRateBps);
	// Substitutes are wages, so they are taxed like the sheet does (Step 1 D41 and Multi Year row 30).
	const payrollTax = ofBps(payrollPay + substitutes, input.settings.payrollTaxBps);
	const personnelTotal = leadership + facultyPay + substitutes + payrollTax + input.settings.medicalCents + input.settings.retirementCents;

	const fixed = group('fixed');
	const totalFixed = personnelTotal + fixed.total.amount;
	const education = group('education');
	const administrative = group('administrative');
	const facility = group('facility');
	const variable = education.total.amount + administrative.total.amount + facility.total.amount;
	const totalExpenses = totalFixed + variable;
	const net = netRevenue - totalExpenses;
	const donation = input.settings.churchDonationCents;

	return {
		census,
		facultyCount: faculty,
		averageTuitionCents,
		revenue: {
			tiers: input.tiers.map((tier) => ({ ...row(tier.label, tier.tuitionCents * tier.students), basis: `${formatBudgetMoney(tier.tuitionCents)} × ${tier.students} students` })),
			fees: input.fees.map((fee, index) => ({ ...row(fee.label, feeAmounts[index]), basis: `${formatBudgetMoney(fee.amountCents)} × ${fee.students ?? census} students` })),
			tuition: row('Tuition', tuition),
			fees_total: row('Fees', feesTotal),
			gross: row('Total gross revenue', gross),
		},
		discounts: { lines: discountGroup.lines, total: row('Total discounts', discountGroup.total.amount) },
		netRevenue: row('Net revenue after discounts', netRevenue),
		personnel: {
			leadership: row('Leadership salaries', leadership),
			faculty: row('Faculty salaries', facultyPay),
			substitutes: row('Substitutes', substitutes),
			payrollTax: row('Payroll tax', payrollTax),
			medical: row('Medical benefits', input.settings.medicalCents),
			retirement: row('Retirement benefits', input.settings.retirementCents),
			total: row('Total personnel', personnelTotal),
		},
		fixed,
		totalFixed: row('Total fixed (personnel + fixed)', totalFixed),
		variable: { education, administrative, facility, total: row('Total variable', variable) },
		totalExpenses: row('Total expenses', totalExpenses),
		net: row('Net income / (loss)', net),
		churchDonation: row('Church donation', donation),
		final: row('Final budget', net + donation),
	};
}

export type BudgetDisplayRow = BudgetStatementRow & { type: 'head' | 'line' | 'subtotal' | 'total' | 'result'; basis?: string; id?: string };

/** The statement as the Budget tab shows it, top to bottom. */
export function budgetStatementRows(statement: BudgetStatement): BudgetDisplayRow[] {
	const out: BudgetDisplayRow[] = [];
	const head = (label: string) => out.push({ label, amount: 0, pctGross: null, type: 'head' });
	const line = (value: BudgetStatementRow & { basis?: string; id?: string }) => out.push({ ...value, type: 'line' });
	const sub = (value: BudgetStatementRow, type: BudgetDisplayRow['type'] = 'subtotal') => out.push({ ...value, type });
	head('Revenue');
	statement.revenue.tiers.forEach(line);
	statement.revenue.fees.forEach(line);
	sub(statement.revenue.gross);
	head('Discounts');
	statement.discounts.lines.forEach(line);
	sub(statement.discounts.total);
	sub(statement.netRevenue, 'total');
	head('Personnel');
	const p = statement.personnel;
	[p.leadership, p.faculty, p.substitutes, p.payrollTax, p.medical, p.retirement].forEach((item) => line(item));
	sub(p.total);
	head('Fixed expenses');
	statement.fixed.lines.forEach(line);
	sub(statement.fixed.total);
	sub(statement.totalFixed, 'total');
	for (const key of ['education', 'administrative', 'facility'] as const) {
		head(budgetSectionLabels[key]);
		statement.variable[key].lines.forEach(line);
		sub(statement.variable[key].total);
	}
	sub(statement.variable.total, 'total');
	sub(statement.totalExpenses, 'total');
	sub(statement.net, 'result');
	line(statement.churchDonation);
	sub(statement.final, 'result');
	return out;
}

/** The rows the Compare tab lines up across scenarios. */
export function budgetCompareRows(statement: BudgetStatement): { key: string; label: string; amount: number; type: 'count' | 'money' | 'result' }[] {
	return [
		{ key: 'census', label: 'Census', amount: statement.census, type: 'count' },
		{ key: 'gross', label: 'Gross revenue', amount: statement.revenue.gross.amount, type: 'money' },
		{ key: 'discounts', label: 'Discounts', amount: statement.discounts.total.amount, type: 'money' },
		{ key: 'net-revenue', label: 'Net revenue', amount: statement.netRevenue.amount, type: 'money' },
		{ key: 'personnel', label: 'Personnel', amount: statement.personnel.total.amount, type: 'money' },
		{ key: 'fixed', label: 'Fixed', amount: statement.fixed.total.amount, type: 'money' },
		{ key: 'variable', label: 'Variable', amount: statement.variable.total.amount, type: 'money' },
		{ key: 'expenses', label: 'Total expenses', amount: statement.totalExpenses.amount, type: 'money' },
		{ key: 'net', label: 'Net income / (loss)', amount: statement.net.amount, type: 'result' },
		{ key: 'donation', label: 'Church donation', amount: statement.churchDonation.amount, type: 'money' },
		{ key: 'final', label: 'Final budget', amount: statement.final.amount, type: 'result' },
	];
}

/** Grow an amount by a rate in basis points, rounded to the cent. */
export const growByBps = (cents: number, bps: number) => round(cents * (10000 + bps) / 10000);

/** "$7,450.50" or "7450.5" → cents; '' → 0; anything else → null. */
export function parseBudgetMoney(text: string): number | null {
	const clean = text.replace(/[$,\s]/g, '');
	if (clean === '') return 0;
	if (!/^-?\d+(\.\d{0,2})?$/.test(clean)) return null;
	const negative = clean.startsWith('-');
	const [whole, part = ''] = clean.replace('-', '').split('.');
	const cents = Number(whole) * 100 + Number(part.padEnd(2, '0'));
	return negative ? -cents : cents;
}
/** "2" or "2%" or "1.5" → basis points; '' → 0; anything else → null. */
export function parseBudgetRate(text: string): number | null {
	const clean = text.replace(/[%\s]/g, '');
	if (clean === '') return 0;
	if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
	const [whole, part = ''] = clean.split('.');
	return Number(whole) * 100 + Number(part.padEnd(2, '0'));
}
/** Cents → "7450.50" for an input's value. */
export const budgetMoneyInput = (cents: number) => (cents / 100).toFixed(2).replace(/\.00$/, '');
/** Basis points → "1.5" for an input's value. */
export const budgetRateInput = (bps: number) => String(bps / 100);
