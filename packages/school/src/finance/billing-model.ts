// Billing: the pure parts (labels, money, schedules, balances). No database here.

export const billingSchedules = ['annual', 'semester', 'ten_month', 'twelve_month'] as const;
export type BillingSchedule = (typeof billingSchedules)[number];
export const billingScheduleLabels: Record<BillingSchedule, string> = {
	annual: 'Annual (1 payment)',
	semester: 'Semester (2 payments)',
	ten_month: '10 months (Aug–May)',
	twelve_month: '12 months (Jul–Jun)',
};
const INSTALLMENTS: Record<BillingSchedule, number> = { annual: 1, semester: 2, ten_month: 10, twelve_month: 12 };

export const entryKinds = ['charge', 'credit', 'payment', 'refund', 'adjustment'] as const;
export type EntryKind = (typeof entryKinds)[number];
export const entryKindLabels: Record<EntryKind, string> = { charge: 'Charge', credit: 'Credit', payment: 'Payment', refund: 'Refund', adjustment: 'Adjustment' };

export const entryCategories = ['tuition', 'registration', 'enrollment_fee', 'other_fee', 'faculty_discount', 'family_discount', 'tuition_assistance', 'other_credit', 'payment'] as const;
export type EntryCategory = (typeof entryCategories)[number];
export const entryCategoryLabels: Record<EntryCategory, string> = {
	tuition: 'Tuition',
	registration: 'Registration fee',
	enrollment_fee: 'Enrollment fee',
	other_fee: 'Other fee',
	faculty_discount: 'Faculty discount',
	family_discount: 'Family discount',
	tuition_assistance: 'Tuition assistance',
	other_credit: 'Other credit',
	payment: 'Payments received',
};
export const chargeCategories: EntryCategory[] = ['tuition', 'registration', 'enrollment_fee', 'other_fee'];
export const creditCategories: EntryCategory[] = ['faculty_discount', 'family_discount', 'tuition_assistance', 'other_credit'];

export const paymentMethods = ['check', 'cash', 'transfer', 'other', 'card_online', 'bank_online'] as const;
export type PaymentMethod = (typeof paymentMethods)[number];
export const paymentMethodLabels: Record<PaymentMethod, string> = { check: 'Check', cash: 'Cash', transfer: 'Bank transfer', other: 'Other', card_online: 'Card (online)', bank_online: 'Bank (online)' };
/** What Finance staff can record by hand; the online methods come from a provider. */
export const manualPaymentMethods: PaymentMethod[] = ['check', 'cash', 'transfer', 'other'];

/** Discounts and aid on a plan. Each maps to a ledger category and to the budget's discount kind, so actuals line up. */
export const planDiscountKinds = ['faculty', 'church', 'sibling', 'assistance', 'other'] as const;
export type PlanDiscountKind = (typeof planDiscountKinds)[number];
export const planDiscountLabels: Record<PlanDiscountKind, string> = { faculty: 'Faculty discount', church: 'Church (TPC) member discount', sibling: 'Sibling discount', assistance: 'Tuition assistance', other: 'Other' };
export const planDiscountCategory: Record<PlanDiscountKind, EntryCategory> = { faculty: 'faculty_discount', church: 'family_discount', sibling: 'family_discount', assistance: 'tuition_assistance', other: 'other_credit' };
export const planDiscountBudgetKind: Record<PlanDiscountKind, 'faculty' | 'family' | 'assistance' | 'other'> = { faculty: 'faculty', church: 'family', sibling: 'family', assistance: 'assistance', other: 'other' };

export type PlanStatus = 'draft' | 'active' | 'closed';
export type RateTier = { label: string; tuitionCents: number; grades: string[] };
export type RateFee = { label: string; amountCents: number };
export type RateCard = { id: string; schoolYear: string; scenarioId: string | null; tiers: RateTier[]; fees: RateFee[]; publishedAt: string; publishedBy: string };
export type PlanFee = { label: string; amountCents: number; dueOn?: string | null };
/** A discount is a flat annual amount (cents) or a percent of tuition (basis points); one of the two. */
export type PlanDiscount = { kind: PlanDiscountKind; label: string; amountCents?: number | null; pctBps?: number | null };
export type Plan = {
	id: string; familyId: string; familyName: string; childId: string | null; childName: string; schoolYear: string;
	tier: string; tuitionCents: number; schedule: BillingSchedule; firstDueOn: string | null;
	fees: PlanFee[]; discounts: PlanDiscount[]; status: PlanStatus; createdBy: string; createdAt: string; updatedAt: string;
};

export type LedgerEntry = {
	id: string; familyId: string; childId: string | null; childName: string; planId: string | null; schoolYear: string;
	kind: EntryKind; direction: 'debit' | 'credit' | null; category: EntryCategory | string; amountCents: number;
	dueOn: string | null; postedOn: string; scheduled: boolean; memo: string;
	method: PaymentMethod | null; reference: string; provider: string; providerRef: string;
	booksRef: string; exportedAt: string | null; createdBy: string; createdAt: string;
	voidedAt: string | null; voidedBy: string; voidReason: string;
};
/** What a caller (staff form, plan activation or a provider's webhook) hands recordEntry. */
export type NewEntry = {
	familyId: string; childId?: string | null; planId?: string | null; schoolYear: string;
	kind: EntryKind; direction?: 'debit' | 'credit' | null; category?: string; amountCents: number;
	dueOn?: string | null; postedOn?: string; scheduled?: boolean; memo?: string;
	method?: PaymentMethod | null; reference?: string; provider?: string; providerRef?: string;
};

/** "$1,234.50". */
export function billingMoney(cents: number): string {
	const negative = cents < 0;
	const text = (Math.abs(cents) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
	return negative ? `−${text}` : text;
}

/** "$1,234.50", "1234.5" or "1,234" → cents. Empty or invalid → null. */
export function parseBillingMoney(input: string): number | null {
	const text = String(input ?? '').replace(/[$,\s]/g, '');
	if (!/^\d+(\.\d{0,2})?$/.test(text)) return null;
	return Math.round(Number(text) * 100);
}

/** +1 when the entry adds to what the family owes, −1 when it reduces it. */
export function entrySign(entry: Pick<LedgerEntry, 'kind' | 'direction'>): 1 | -1 {
	if (entry.kind === 'charge' || entry.kind === 'refund') return 1;
	if (entry.kind === 'adjustment') return entry.direction === 'debit' ? 1 : -1;
	return -1;
}

export type BillingBalance = { billedCents: number; creditedCents: number; paidCents: number; balanceCents: number; dueNowCents: number };

/**
 * Balance = charges + debit adjustments + refunds − credits − payments − credit adjustments,
 * voided entries left out. Due now counts only what is due by `today` (payments always count).
 */
export function billingBalance(entries: Pick<LedgerEntry, 'kind' | 'direction' | 'amountCents' | 'dueOn' | 'voidedAt'>[], today: string): BillingBalance {
	const out = { billedCents: 0, creditedCents: 0, paidCents: 0, balanceCents: 0, dueNowCents: 0 };
	for (const entry of entries) {
		if (entry.voidedAt) continue;
		const signed = entrySign(entry) * entry.amountCents;
		if (entry.kind === 'payment') out.paidCents += entry.amountCents;
		else if (entry.kind === 'refund') out.paidCents -= entry.amountCents;
		else if (signed > 0) out.billedCents += entry.amountCents;
		else out.creditedCents += entry.amountCents;
		out.balanceCents += signed;
		if (!entry.dueOn || entry.dueOn <= today) out.dueNowCents += signed;
	}
	return out;
}

/** The tier whose label covers a grade ("½ day K–4th" covers K, 1…4). Unparseable labels never match. */
export function tierForGrade(tiers: RateTier[], grade: string): RateTier | null {
	const g = normalizeGrade(grade);
	if (!g) return null;
	return tiers.find((tier) => tier.grades.includes(g)) ?? null;
}

const GRADE_ORDER = ['PK', 'K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
function normalizeGrade(grade: string): string {
	const text = String(grade ?? '').trim().toUpperCase().replace(/(ST|ND|RD|TH)$/, '').replace(/^GRADE\s*/, '');
	if (text === 'KINDERGARTEN' || text === 'K') return 'K';
	if (text === 'PRE-K' || text === 'PREK' || text === 'PK') return 'PK';
	return GRADE_ORDER.includes(text) ? text : '';
}

/** Grades a tier label names: "½ day K–4th" → K…4, "5th–8th" → 5…8, "Kindergarten" → K. */
export function gradesFromTierLabel(label: string): string[] {
	const range = /\b(PK|Pre-?K|K|\d{1,2})(?:st|nd|rd|th)?\s*(?:[–—-]|to|through)\s*(\d{1,2})(?:st|nd|rd|th)?\b/i.exec(label);
	if (range) {
		const from = GRADE_ORDER.indexOf(normalizeGrade(range[1])), to = GRADE_ORDER.indexOf(normalizeGrade(range[2]));
		if (from >= 0 && to >= from) return GRADE_ORDER.slice(from, to + 1);
	}
	const single = /\b(PK|Pre-?K|K|Kindergarten|\d{1,2})(?:st|nd|rd|th)?\b/i.exec(label);
	const grade = single ? normalizeGrade(single[1]) : '';
	return grade ? [grade] : [];
}

/** A fee's ledger category from its label. */
export function feeCategory(label: string): EntryCategory {
	if (/regist/i.test(label)) return 'registration';
	if (/enrol/i.test(label)) return 'enrollment_fee';
	return 'other_fee';
}

/** The school year's first month for a schedule: July for twelve months, otherwise August. "2026–27" → "2026-08-01". */
export function defaultFirstDue(schoolYear: string, schedule: BillingSchedule): string {
	const start = Number(schoolYear.slice(0, 4)) || new Date().getUTCFullYear();
	return `${start}-${schedule === 'twelve_month' ? '07' : '08'}-01`;
}

function addMonths(iso: string, months: number): string {
	const [year, month, day] = iso.split('-').map(Number);
	const target = new Date(Date.UTC(year, month - 1 + months, 1));
	const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
	target.setUTCDate(Math.min(day, last));
	return target.toISOString().slice(0, 10);
}

/** Due dates for a schedule: monthly, or a semester apart (five months). */
export function installmentDates(schedule: BillingSchedule, firstDueOn: string): string[] {
	const count = INSTALLMENTS[schedule];
	const step = schedule === 'semester' ? 5 : 1;
	return Array.from({ length: count }, (_, index) => addMonths(firstDueOn, index * step));
}

/** Split cents into n parts that add back up exactly (the first parts carry the extra cents). */
export function splitCents(total: number, parts: number): number[] {
	const base = Math.floor(total / parts), extra = total - base * parts;
	return Array.from({ length: parts }, (_, index) => base + (index < extra ? 1 : 0));
}

export function discountCents(discount: PlanDiscount, tuitionCents: number): number {
	if (discount.pctBps != null && discount.pctBps > 0) return Math.round((tuitionCents * discount.pctBps) / 10000);
	return Math.max(0, Math.round(discount.amountCents ?? 0));
}

export type ScheduledLine = { kind: 'charge' | 'credit'; category: EntryCategory; amountCents: number; dueOn: string; memo: string };

/**
 * Every scheduled charge and credit a plan should have: tuition split over the installments,
 * each discount split the same way (so due-now stays net), and each fee once.
 * `today` dates a fee that has no date of its own.
 */
export function planLines(plan: Pick<Plan, 'tuitionCents' | 'schedule' | 'firstDueOn' | 'fees' | 'discounts' | 'schoolYear'>, today: string): ScheduledLine[] {
	const first = plan.firstDueOn || defaultFirstDue(plan.schoolYear, plan.schedule);
	const dates = installmentDates(plan.schedule, first);
	const n = dates.length;
	const lines: ScheduledLine[] = [];
	const label = (text: string, index: number) => n > 1 ? `${text} ${index + 1}/${n}` : text;
	splitCents(plan.tuitionCents, n).forEach((amount, index) => {
		if (amount > 0) lines.push({ kind: 'charge', category: 'tuition', amountCents: amount, dueOn: dates[index], memo: label('Tuition', index) });
	});
	for (const discount of plan.discounts) {
		const total = Math.min(discountCents(discount, plan.tuitionCents), plan.tuitionCents);
		splitCents(total, n).forEach((amount, index) => {
			if (amount > 0) lines.push({ kind: 'credit', category: planDiscountCategory[discount.kind] ?? 'other_credit', amountCents: amount, dueOn: dates[index], memo: label(discount.label || planDiscountLabels[discount.kind], index) });
		});
	}
	for (const fee of plan.fees) {
		if (fee.amountCents > 0) lines.push({ kind: 'charge', category: feeCategory(fee.label), amountCents: fee.amountCents, dueOn: fee.dueOn || today, memo: fee.label });
	}
	return lines.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || (a.kind === b.kind ? 0 : a.kind === 'charge' ? -1 : 1));
}

/** Net tuition for a plan: tuition − its discounts (fees not included). */
export function planNetCents(plan: Pick<Plan, 'tuitionCents' | 'discounts'>): number {
	const off = plan.discounts.reduce((sum, discount) => sum + discountCents(discount, plan.tuitionCents), 0);
	return Math.max(0, plan.tuitionCents - off);
}

export type InstallmentStatus = 'paid' | 'partial' | 'due' | 'upcoming';
export type Installment = { dueOn: string; amountCents: number; coveredCents: number; status: InstallmentStatus };

/**
 * The year's schedule for display: scheduled charges net of their scheduled credits, by due date,
 * with payments and other credits applied oldest first. Display only: payments apply to the balance.
 */
export function installmentCoverage(entries: Pick<LedgerEntry, 'kind' | 'direction' | 'amountCents' | 'dueOn' | 'postedOn' | 'voidedAt' | 'scheduled'>[], today: string): Installment[] {
	const byDate = new Map<string, number>();
	let pool = 0;
	for (const entry of entries) {
		if (entry.voidedAt) continue;
		const signed = entrySign(entry) * entry.amountCents;
		const date = entry.dueOn || entry.postedOn;
		if (entry.kind === 'charge' || (entry.kind === 'adjustment' && signed > 0) || (entry.scheduled && entry.kind === 'credit')) {
			byDate.set(date, (byDate.get(date) ?? 0) + signed);
		} else pool -= signed;
	}
	const rows = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
	return rows.filter(([, amount]) => amount > 0).map(([dueOn, amountCents]) => {
		const coveredCents = Math.max(0, Math.min(amountCents, pool));
		pool -= coveredCents;
		const status: InstallmentStatus = coveredCents >= amountCents ? 'paid' : coveredCents > 0 ? 'partial' : dueOn <= today ? 'due' : 'upcoming';
		return { dueOn, amountCents, coveredCents, status };
	});
}

/** QuickBooks transaction type for an entry. */
export function booksType(entry: Pick<LedgerEntry, 'kind' | 'direction'>): 'Invoice' | 'Payment' | 'Credit Memo' | 'Refund Receipt' {
	if (entry.kind === 'payment') return 'Payment';
	if (entry.kind === 'refund') return 'Refund Receipt';
	return entrySign(entry) > 0 ? 'Invoice' : 'Credit Memo';
}
