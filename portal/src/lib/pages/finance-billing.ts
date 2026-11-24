import type { AstroGlobal } from 'astro';
import { runActions, redirectOnSuccess, toastFrom, type ActionHandler } from '../actions.ts';
import { csrfToken } from '../security.ts';
import {
	activateDraftPlans, activatePlan, billingHousehold, billingPrimaryScenario, billingSchedules, billingYears, chicagoToday, closePlan, createDraftPlans,
	getBillingSettings, getBooksAccounts, getEntry, getPlan, getRateCard, householdLedger, lastBooksExport, listBillingAccounts, listBillingPayments,
	listFamilyEntries, listFamilyPlans, listPlans, onlinePaymentProvider, parseBillingMoney, planDiscountKinds, publishRateCard, recordEntry,
	saveBillingSettings, saveBooksAccounts, savePlan, schoolYearOf, shiftSchoolYear, voidEntry, entryCategories,
	type BillingSchedule, type EntryKind, type PaymentMethod, type Plan, type PlanDiscount, type PlanDiscountKind, type PlanFee, type PlanInput,
} from '@tca/school';

type Locals = AstroGlobal['locals'];
type Family = NonNullable<Locals['family']>;

/** ?year=2026–27, or the current school year. */
export function financeYear(url: URL): string {
	const year = url.searchParams.get('year') ?? '';
	return /^\d{4}–\d{2}$/.test(year) ? year : schoolYearOf();
}

/** Last year, this year and the next two, for the year pill. */
export function financeYearOptions(selected: string) {
	const now = schoolYearOf();
	const years = [...new Set([shiftSchoolYear(now, 1), now, shiftSchoolYear(now, -1), selected])].sort().reverse();
	return years.map((year) => ({ value: year === now ? '' : year, label: year }));
}

export function withParams(url: URL, changes: Record<string, string | null>): string {
	const next = new URL(url);
	for (const [key, value] of Object.entries(changes)) value ? next.searchParams.set(key, value) : next.searchParams.delete(key);
	return next.pathname + next.search;
}

const by = (Astro: AstroGlobal) => Astro.locals.sessionEmail || Astro.locals.family?.email || '';
const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** "$500" → flat cents; "10%" → basis points. */
export function parseAmountOrPct(input: string): { amountCents?: number; pctBps?: number } | null {
	const value = input.trim();
	if (!value) return null;
	if (value.endsWith('%')) {
		const pct = Number(value.slice(0, -1).trim());
		return Number.isFinite(pct) && pct > 0 && pct <= 100 ? { pctBps: Math.round(pct * 100) } : null;
	}
	const cents = parseBillingMoney(value);
	return cents && cents > 0 ? { amountCents: cents } : null;
}

export const discountText = (discount: PlanDiscount) => discount.pctBps ? `${discount.pctBps / 100}%` : discount.amountCents ? (discount.amountCents / 100).toFixed(2) : '';

async function planFromForm(form: FormData, base: Partial<PlanInput>): Promise<PlanInput | { error: string; fields: Record<string, string> }> {
	// A blank tuition, or "use the current rate", takes the tier's tuition from the year's rate card.
	const schoolYear = base.schoolYear ?? text(form, 'schoolYear');
	const tierRate = async () => (await getRateCard(schoolYear))?.tiers.find((tier) => tier.label === text(form, 'tier'))?.tuitionCents ?? null;
	const tuition = text(form, 'reprice') === 'on' || !text(form, 'tuition') ? await tierRate() : parseBillingMoney(text(form, 'tuition'));
	const fields: Record<string, string> = {};
	if (tuition === null) fields.tuition = 'Enter the tuition, like 7,450';
	const firstDue = text(form, 'firstDueOn');
	if (firstDue && !isDate(firstDue)) fields.firstDueOn = 'Enter a date';
	const fees: PlanFee[] = [];
	const feeLabels = form.getAll('feeLabel').map(String), feeAmounts = form.getAll('feeAmount').map(String), feeDue = form.getAll('feeDue').map(String);
	feeLabels.forEach((label, index) => {
		const amount = parseBillingMoney(feeAmounts[index] ?? '');
		if (!label.trim() && !feeAmounts[index]?.trim()) return;
		if (!label.trim() || !amount) { fields.fees = 'Each fee needs a name and an amount'; return; }
		fees.push({ label, amountCents: amount, ...(isDate(feeDue[index] ?? '') ? { dueOn: feeDue[index] } : {}) });
	});
	const discounts: PlanDiscount[] = [];
	const kinds = form.getAll('discountKind').map(String), labels = form.getAll('discountLabel').map(String), amounts = form.getAll('discountAmount').map(String);
	kinds.forEach((kind, index) => {
		if (!amounts[index]?.trim()) return;
		const amount = parseAmountOrPct(amounts[index]);
		if (!amount || !(planDiscountKinds as readonly string[]).includes(kind)) { fields.discounts = 'Enter each discount as an amount ($500) or a percent (10%)'; return; }
		discounts.push({ kind: kind as PlanDiscountKind, label: labels[index] ?? '', ...amount });
	});
	if (Object.keys(fields).length) return { error: 'Fix the highlighted fields to save.', fields };
	return {
		id: base.id, familyId: base.familyId ?? text(form, 'familyId'), childId: base.childId ?? (text(form, 'childId') || null),
		schoolYear, tier: text(form, 'tier'), tuitionCents: tuition!,
		schedule: text(form, 'schedule') as BillingSchedule, firstDueOn: firstDue || null, fees, discounts,
	};
}

/** Plan sheet actions, shared by the household ledger and the Plans page. `back(planId, flag)` is where each lands. */
function planActions(Astro: AstroGlobal, back: (planId: string, flag: string) => string, scope?: { familyId: string; schoolYear: string }): Record<string, ActionHandler<undefined>> {
	const load = async (form: FormData) => {
		const plan = await getPlan(text(form, 'planId'));
		return plan && (!scope || plan.familyId === scope.familyId) ? plan : null;
	};
	return {
		'plan-save': async (form) => {
			const existing = text(form, 'planId') ? await load(form) : null;
			if (text(form, 'planId') && !existing) return { error: 'That plan no longer exists.' };
			const parsed = await planFromForm(form, existing ? existing : { familyId: scope?.familyId, schoolYear: scope?.schoolYear });
			if ('error' in parsed) return parsed;
			const result = await savePlan(parsed, by(Astro));
			if (!result.ok) return { error: result.error, fields: 'fields' in result ? result.fields : undefined };
			if (text(form, 'then') === 'activate' && (!existing || existing.status === 'draft')) {
				const activated = await activatePlan(result.id, by(Astro));
				if (!activated.ok) return { redirect: back(result.id, `planerror=${encodeURIComponent(activated.error)}`) };
				return { redirect: back('', 'activated=1') };
			}
			return { redirect: back('', 'saved=plan') };
		},
		'plan-close': async (form) => {
			const plan = await load(form);
			if (!plan) return { error: 'That plan no longer exists.' };
			return redirectOnSuccess(await closePlan(plan.id, by(Astro)), back('', 'closed=1'));
		},
	};
}

// ---- /finance/families ----

export const ACCOUNT_FILTERS = [{ value: '', label: 'All' }, { value: 'balance', label: 'Has a balance' }, { value: 'pastdue', label: 'Past due' }, { value: 'aid', label: 'Has aid' }];

export async function loadFinanceFamilies(Astro: AstroGlobal) {
	const year = financeYear(Astro.url);
	const show = ACCOUNT_FILTERS.some((row) => row.value === Astro.url.searchParams.get('show')) ? Astro.url.searchParams.get('show')! : '';
	const q = (Astro.url.searchParams.get('q') ?? '').trim();
	const all = await listBillingAccounts(year);
	const needle = q.toLowerCase();
	const accounts = all.filter((row) => (show !== 'balance' || row.balanceCents > 0) && (show !== 'pastdue' || row.dueNowCents > 0) && (show !== 'aid' || row.hasAid)
		&& (!needle || `${row.familyName} ${row.students.join(' ')}`.toLowerCase().includes(needle)));
	const totals = accounts.reduce((sum, row) => ({ billed: sum.billed + row.billedCents, paid: sum.paid + row.paidCents, balance: sum.balance + row.balanceCents, due: sum.due + Math.max(0, row.dueNowCents) }), { billed: 0, paid: 0, balance: 0, due: 0 });
	return { year, years: financeYearOptions(year), show, q, accounts, total: all.length, totals };
}
export type FinanceFamiliesView = Awaited<ReturnType<typeof loadFinanceFamilies>>;

// ---- /finance/families/[id] ----

export const ENTRY_SHEETS = ['payment', 'charge', 'credit', 'adjust'] as const;
export type EntrySheetKind = (typeof ENTRY_SHEETS)[number];

export async function loadFinanceHousehold(Astro: AstroGlobal, familyId: string) {
	const secure = Astro.url.protocol === 'https:';
	const csrf = csrfToken(Astro.cookies, secure);
	const household = await billingHousehold(familyId);
	if (!household) return new Response(null, { status: 404 });
	if (household.id !== familyId) return Astro.redirect(`/finance/families/${household.id}${Astro.url.search}`);
	const year = financeYear(Astro.url);
	const base = `/finance/families/${household.id}${year === schoolYearOf() ? '' : `?year=${encodeURIComponent(year)}`}`;
	const link = (extra: string) => extra ? `${base}${base.includes('?') ? '&' : '?'}${extra}` : base;
	const actionResult = await runActions(Astro, {
		entry: async (form) => {
			const kind = text(form, 'kind') as EntryKind;
			const amount = parseBillingMoney(text(form, 'amount'));
			if (!amount) return { error: 'Enter an amount over $0.', fields: { amount: 'Enter an amount' } };
			const date = text(form, 'date');
			const result = await recordEntry({
				familyId: household.id, schoolYear: year, kind, amountCents: amount,
				direction: kind === 'adjustment' ? (text(form, 'direction') === 'debit' ? 'debit' : 'credit') : null,
				category: kind === 'payment' || kind === 'refund' ? 'payment' : text(form, 'category'),
				childId: household.children.some((child) => child.id === text(form, 'childId')) ? text(form, 'childId') : null,
				postedOn: isDate(date) ? date : chicagoToday(),
				dueOn: kind === 'charge' && isDate(text(form, 'dueOn')) ? text(form, 'dueOn') : null,
				method: kind === 'payment' || kind === 'refund' ? (text(form, 'method') as PaymentMethod) : null,
				reference: text(form, 'reference'), memo: text(form, 'memo'), provider: kind === 'payment' || kind === 'refund' ? 'manual' : '',
			}, by(Astro));
			return redirectOnSuccess(result, link(`saved=${kind}`));
		},
		void: async (form) => {
			const entry = await getEntry(text(form, 'entryId'));
			if (!entry || !(await listFamilyEntries(household.id)).some((row) => row.id === entry.id)) return { error: 'That entry no longer exists.' };
			const result = await voidEntry(entry.id, text(form, 'reason'), by(Astro));
			if (!result.ok) return { error: result.error, fields: result.fields };
			return { redirect: link('voided=1') };
		},
		...planActions(Astro, (planId, flag) => link([planId && `plan=${planId}`, flag].filter(Boolean).join('&')), { familyId: household.id, schoolYear: year }),
	});
	if ('redirect' in actionResult) return Astro.redirect(actionResult.redirect, actionResult.status);
	const [ledger, plans, card] = await Promise.all([householdLedger(household.id, year), listFamilyPlans(household.id, year), getRateCard(year)]);
	const params = Astro.url.searchParams;
	const sheet = (ENTRY_SHEETS as readonly string[]).includes(params.get('sheet') ?? '') ? params.get('sheet') as EntrySheetKind : null;
	const planParam = params.get('plan');
	const editingPlan: Plan | null = planParam && planParam !== 'new' ? plans.find((plan) => plan.id === planParam) ?? null : null;
	const entry = params.get('entry') ? ledger.lines.find((line) => line.id === params.get('entry')) ?? null : null;
	const toast = toastFrom(Astro.url, {
		saved: (value) => ({ payment: 'Payment recorded.', refund: 'Refund recorded.', charge: 'Charge added.', credit: 'Credit added.', adjustment: 'Adjustment added.', plan: 'Plan saved.' } as Record<string, string>)[value] ?? 'Saved.',
		voided: 'Entry voided.', activated: 'Plan activated. Its charges are on the ledger.', closed: 'Plan closed.', repriced: 'Plan repriced.',
	});
	const planError = params.get('planerror') ?? '';
	const studentsWithoutPlan = household.children.filter((child) => !plans.some((plan) => plan.childId === child.id));
	return {
		csrf, household, year, years: financeYearOptions(year), base, link, ledger, plans, card, sheet, entry, toast,
		plan: { editing: editingPlan, isNew: planParam === 'new', children: studentsWithoutPlan, error: planError || (planParam ? actionResult.error : ''), fields: actionResult.fields },
		error: planParam ? '' : actionResult.error, fields: actionResult.fields, confirmVoid: params.get('void') === '1', confirmClose: params.get('close') === '1',
	};
}
export type FinanceHouseholdView = Exclude<Awaited<ReturnType<typeof loadFinanceHousehold>>, Response>;

// ---- /finance/plans ----

export const PLAN_STATUS_FILTERS = [{ value: '', label: 'Any' }, { value: 'draft', label: 'Draft' }, { value: 'active', label: 'Active' }, { value: 'closed', label: 'Closed' }];

export async function loadFinancePlans(Astro: AstroGlobal) {
	const csrf = csrfToken(Astro.cookies, Astro.url.protocol === 'https:');
	const year = financeYear(Astro.url);
	const status = PLAN_STATUS_FILTERS.some((row) => row.value === Astro.url.searchParams.get('status')) ? Astro.url.searchParams.get('status')! : '';
	const link = (extra: Record<string, string | null>) => withParams(Astro.url, { plan: null, close: null, confirm: null, saved: null, activated: null, closed: null, repriced: null, created: null, unmatched: null, planerror: null, ...extra });
	const actionResult = await runActions(Astro, {
		'create-drafts': async () => {
			const result = await createDraftPlans(year, by(Astro));
			return result.ok ? { redirect: link({ created: String(result.created), unmatched: result.unmatched ? String(result.unmatched) : null }) } : { error: result.error };
		},
		'activate-drafts': async () => {
			const result = await activateDraftPlans(year, by(Astro));
			return result.ok ? { redirect: link({ activated: String(result.activated) }) } : { error: result.error };
		},
		...planActions(Astro, (planId, flag) => {
			const [key, value] = flag.split('=');
			return link({ plan: planId || null, [key]: decodeURIComponent(value ?? '1') });
		}),
	});
	if ('redirect' in actionResult) return Astro.redirect(actionResult.redirect, actionResult.status);
	const [all, card] = await Promise.all([listPlans(year), getRateCard(year)]);
	const plans = all.filter((plan) => !status || plan.status === status);
	const editing = all.find((plan) => plan.id === Astro.url.searchParams.get('plan')) ?? null;
	const created = Astro.url.searchParams.get('created'), unmatched = Number(Astro.url.searchParams.get('unmatched') ?? 0);
	const toast = toastFrom(Astro.url, {
		created: (value) => value === '0' ? 'Every enrolled student already has a plan.' : `${value} draft ${value === '1' ? 'plan' : 'plans'} created${unmatched ? `; ${unmatched} need a tier` : ''}.`,
		activated: (value) => value === '1' && !created ? 'Plan activated. Its charges are on the ledger.' : `${value} ${value === '1' ? 'plan' : 'plans'} activated.`,
		saved: 'Plan saved.', closed: 'Plan closed.', repriced: 'Plan repriced.',
	});
	return {
		csrf, year, years: financeYearOptions(year), status, plans, card, editing, toast, link,
		drafts: all.filter((plan) => plan.status === 'draft').length, confirm: Astro.url.searchParams.get('confirm'),
		error: editing ? '' : actionResult.error,
		plan: { editing, isNew: false, children: [], error: Astro.url.searchParams.get('planerror') || (editing ? actionResult.error : ''), fields: actionResult.fields },
	};
}
export type FinancePlansView = Exclude<Awaited<ReturnType<typeof loadFinancePlans>>, Response>;

// ---- /finance/payments ----

export async function loadFinancePayments(Astro: AstroGlobal) {
	const csrf = csrfToken(Astro.cookies, Astro.url.protocol === 'https:');
	const today = chicagoToday();
	const from = isDate(Astro.url.searchParams.get('from') ?? '') ? Astro.url.searchParams.get('from')! : `${today.slice(0, 8)}01`;
	const to = isDate(Astro.url.searchParams.get('to') ?? '') ? Astro.url.searchParams.get('to')! : today;
	const [payments, lastExport] = await Promise.all([listBillingPayments(from, to), lastBooksExport()]);
	const live = payments.filter((row) => !row.voidedAt);
	const totalCents = live.reduce((sum, row) => sum + (row.kind === 'payment' ? row.amountCents : -row.amountCents), 0);
	const sheet = Astro.url.searchParams.get('sheet') === 'export' ? 'export' : '';
	return { csrf, today, from, to, payments, totalCents, count: live.length, lastExport, sheet };
}
export type FinancePaymentsView = Awaited<ReturnType<typeof loadFinancePayments>>;

// ---- /finance/settings ----

export async function loadFinanceSettings(Astro: AstroGlobal) {
	const csrf = csrfToken(Astro.cookies, Astro.url.protocol === 'https:');
	const year = financeYear(Astro.url);
	const back = (flag: string) => withParams(Astro.url, { saved: null, published: null, [flag]: '1' });
	const actionResult = await runActions(Astro, {
		'publish-rates': async () => redirectOnSuccess(await publishRateCard(year, by(Astro)), back('published')),
		'save-settings': async (form) => redirectOnSuccess(await saveBillingSettings({
			defaultSchedule: text(form, 'defaultSchedule') as BillingSchedule, payableTo: text(form, 'payableTo'), howToPay: String(form.get('howToPay') ?? ''),
		}), back('saved')),
		'save-accounts': async (form) => {
			const accounts: Record<string, string> = {};
			for (const category of entryCategories) if (form.has(`account:${category}`)) accounts[category] = text(form, `account:${category}`);
			return redirectOnSuccess(await saveBooksAccounts(accounts), back('saved'));
		},
	});
	if ('redirect' in actionResult) return Astro.redirect(actionResult.redirect, actionResult.status);
	const [card, scenario, settings, accounts] = await Promise.all([getRateCard(year), billingPrimaryScenario(year), getBillingSettings(), getBooksAccounts()]);
	const toast = toastFrom(Astro.url, { published: `Billing now uses these ${year} rates. Existing plans keep theirs until repriced.`, saved: 'Settings saved.' });
	return { csrf, year, years: financeYearOptions(year), card, scenario, settings, accounts, toast, error: actionResult.error, schedules: billingSchedules };
}
export type FinanceSettingsView = Exclude<Awaited<ReturnType<typeof loadFinanceSettings>>, Response>;

// ---- /billing (the family's own) ----

export async function loadFamilyBilling(Astro: AstroGlobal, family: Family) {
	// Every query is scoped to the signed-in household.
	const familyId = family.id;
	const years = await billingYears(familyId);
	const now = schoolYearOf();
	const asked = Astro.url.searchParams.get('year') ?? '';
	const year = years.includes(asked) ? asked : years.includes(now) ? now : years[0] ?? now;
	const today = chicagoToday();
	const [ledger, plans, settings] = await Promise.all([householdLedger(familyId, year, today), listFamilyPlans(familyId, year), getBillingSettings()]);
	// Families see what stands, not voided mistakes.
	let running = 0;
	const lines = ledger.lines.filter((line) => !line.voidedAt).map((line) => ({ ...line, runningCents: (running += line.signedCents) }));
	const history = lines.filter((line) => line.kind === 'payment' || line.kind === 'refund').reverse();
	return {
		family, year, years, today, ledger: { ...ledger, lines }, history, plans: plans.filter((plan) => plan.status !== 'draft'),
		settings, online: onlinePaymentProvider(), print: Astro.url.searchParams.get('print') === '1',
	};
}
export type FamilyBillingView = Awaited<ReturnType<typeof loadFamilyBilling>>;
