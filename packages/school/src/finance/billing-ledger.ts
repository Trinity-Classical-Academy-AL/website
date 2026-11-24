// Billing: the ledger (entries, voids, balances) and the rate card, books mapping and settings.
import { randomUUID } from 'node:crypto';
import { db, dbReady, type Sql } from '../db.ts';
import { readSetting, writeSetting } from '../data.ts';
import { logFamilyActivity } from '../family-merge.ts';
import type { Result } from '../result.ts';
import { chicagoToday } from '../time.ts';
import { primaryScenario, scenarioRates } from './budget.ts';
import {
	billingBalance, chargeCategories, creditCategories, entryCategories, entryCategoryLabels, entryKinds, entrySign,
	gradesFromTierLabel, installmentCoverage, paymentMethodLabels, paymentMethods, billingSchedules, planDiscountBudgetKind,
	type BillingBalance, type BillingSchedule, type EntryCategory, type Installment, type LedgerEntry, type NewEntry, type RateCard, type RateFee, type RateTier,
} from './billing-model.ts';

const iso = (value: unknown) => value ? new Date(value as string).toISOString() : '';
type Tx = Sql;

/** Entries of a household, including any household that was merged into it. */
const householdIds = (sql: Tx, familyId: string) => sql`select id from families where id = ${familyId} or merged_into_id = ${familyId}`;

export function mapEntry(row: Record<string, any>): LedgerEntry {
	return {
		id: String(row.id), familyId: String(row.family_id), childId: row.child_id ? String(row.child_id) : null,
		childName: String(row.child_name ?? ''), planId: row.plan_id ? String(row.plan_id) : null, schoolYear: String(row.school_year),
		kind: row.kind, direction: row.direction ?? null, category: String(row.category), amountCents: Number(row.amount_cents),
		dueOn: row.due_on ?? null, postedOn: String(row.posted_on), scheduled: Boolean(row.scheduled), memo: String(row.memo ?? ''),
		method: row.method ?? null, reference: String(row.reference ?? ''), provider: String(row.provider ?? ''), providerRef: String(row.provider_ref ?? ''),
		booksRef: String(row.books_ref ?? ''), exportedAt: row.exported_at ? iso(row.exported_at) : null, createdBy: String(row.created_by ?? ''),
		createdAt: iso(row.created_at), voidedAt: row.voided_at ? iso(row.voided_at) : null, voidedBy: String(row.voided_by ?? ''), voidReason: String(row.void_reason ?? ''),
	};
}

/** What an entry is, in a few words: "Tuition 3/10", "Payment · check 1042". */
export function entryLabel(entry: Pick<LedgerEntry, 'kind' | 'category' | 'memo' | 'method' | 'reference'>): string {
	if (entry.kind === 'payment' || entry.kind === 'refund') {
		const how = [entry.method ? paymentMethodLabels[entry.method] : '', entry.reference].filter(Boolean).join(' ');
		return [entry.kind === 'payment' ? 'Payment' : 'Refund', how, entry.memo].filter(Boolean).join(' · ');
	}
	const category = entryCategoryLabels[entry.category as EntryCategory] ?? entry.category;
	if (!entry.memo) return entry.kind === 'adjustment' ? `Adjustment · ${category}` : category;
	return entry.kind === 'adjustment' ? `Adjustment · ${entry.memo}` : entry.memo;
}

function activityLine(entry: NewEntry): string {
	// No amounts: the family activity log is visible to admins without the Finance role.
	if (entry.kind === 'payment' || entry.kind === 'refund') {
		const how = [entry.method ? paymentMethodLabels[entry.method] : '', entry.reference].filter(Boolean).join(' ').toLowerCase();
		return `${entry.kind === 'payment' ? 'Payment' : 'Refund'} recorded${how ? ` (${how})` : ''}`;
	}
	const what = entry.memo || entryCategoryLabels[entry.category as EntryCategory] || entry.category || '';
	return `${entry.kind === 'charge' ? 'Charge added' : entry.kind === 'credit' ? 'Credit added' : 'Adjustment'}${what ? `: ${what}` : ''}`;
}

function checkEntry(input: NewEntry): string {
	if (!(entryKinds as readonly string[]).includes(input.kind)) return 'Choose what kind of entry this is.';
	if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return 'Enter an amount over $0.';
	if (!input.schoolYear) return 'Choose a school year.';
	if (input.kind === 'adjustment' && input.direction !== 'debit' && input.direction !== 'credit') return 'Choose whether the adjustment adds to or takes off the balance.';
	if ((input.kind === 'payment' || input.kind === 'refund') && !(paymentMethods as readonly string[]).includes(input.method ?? '')) return 'Choose how it was paid.';
	if (input.kind === 'charge' && !chargeCategories.includes(input.category as EntryCategory)) return 'Choose what the charge is for.';
	if (input.kind === 'credit' && !creditCategories.includes(input.category as EntryCategory)) return 'Choose what the credit is for.';
	if (input.kind === 'adjustment' && !(entryCategories as readonly string[]).includes(input.category ?? '')) return 'Choose a category.';
	if (input.dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn)) return 'Enter the due date as a date.';
	if (input.postedOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.postedOn)) return 'Enter the date as a date.';
	return '';
}

/** Insert one entry inside a caller's transaction. Validates; never logs. */
export async function insertEntry(sql: Tx, input: NewEntry, by: string): Promise<Result<{ id: string; duplicate: boolean }>> {
	const category = input.category || (input.kind === 'payment' || input.kind === 'refund' ? 'payment' : input.kind === 'credit' ? 'other_credit' : input.kind === 'charge' ? 'other_fee' : '');
	const entry = { ...input, category };
	const error = checkEntry(entry);
	if (error) return { ok: false, error };
	if (entry.provider && entry.providerRef) {
		const [existing] = await sql`select id from finance_entries where provider = ${entry.provider} and provider_ref = ${entry.providerRef}`;
		if (existing) return { ok: true, id: String(existing.id), duplicate: true };
	}
	const id = randomUUID();
	const postedOn = entry.postedOn || chicagoToday();
	await sql`
		insert into finance_entries (id, family_id, child_id, plan_id, school_year, kind, direction, category, amount_cents, due_on, posted_on, scheduled, memo, method, reference, provider, provider_ref, created_by)
		values (${id}, ${entry.familyId}, ${entry.childId || null}, ${entry.planId || null}, ${entry.schoolYear}, ${entry.kind}, ${entry.kind === 'adjustment' ? entry.direction! : null},
			${category}, ${entry.amountCents}, ${entry.dueOn || null}, ${postedOn}, ${Boolean(entry.scheduled)}, ${(entry.memo ?? '').trim().slice(0, 500)},
			${entry.kind === 'payment' || entry.kind === 'refund' ? entry.method! : null}, ${(entry.reference ?? '').trim().slice(0, 120)},
			${entry.provider ?? ''}, ${entry.providerRef ?? ''}, ${by})`;
	return { ok: true, id, duplicate: false };
}

/**
 * The one way an entry reaches the ledger: Finance staff, plan activation and a payment
 * provider's webhook all come through here. Writes a family activity line (without amounts).
 */
export async function recordEntry(input: NewEntry, by: string): Promise<Result<{ id: string }>> {
	await dbReady();
	const [family] = await db()`select coalesce(merged_into_id, id) as id from families where id = ${input.familyId}`;
	if (!family) return { ok: false, error: 'That family no longer exists.' };
	const result = await insertEntry(db(), { ...input, familyId: String(family.id) }, by);
	if (!result.ok) return result;
	if (!result.duplicate) await logFamilyActivity(String(family.id), 'note', by, activityLine(input));
	return { ok: true, id: result.id };
}

/** Void an entry with a reason. Nothing is deleted or edited in place. */
export async function voidEntry(id: string, reason: string, by: string): Promise<Result<{ familyId: string }>> {
	await dbReady();
	const why = reason.trim();
	if (!why) return { ok: false, error: 'Say why this entry is being voided.', fields: { reason: 'Required' } };
	const [row] = await db()`
		update finance_entries set voided_at = now(), voided_by = ${by}, void_reason = ${why.slice(0, 500)}
		where id = ${id} and voided_at is null returning *`;
	if (!row) return { ok: false, error: 'That entry was already voided or no longer exists.' };
	const entry = mapEntry(row);
	await logFamilyActivity(entry.familyId, 'note', by, `Voided ${entry.kind}: ${why}`);
	return { ok: true, familyId: entry.familyId };
}

const ENTRY_SELECT = (sql: Tx) => sql`
	select e.*, coalesce(nullif(c.name, ''), p.child_name, '') as child_name
	from finance_entries e left join children c on c.id = e.child_id left join finance_plans p on p.id = e.plan_id`;

export async function listFamilyEntries(familyId: string, schoolYear?: string): Promise<LedgerEntry[]> {
	await dbReady();
	const sql = db();
	const rows = await sql`${ENTRY_SELECT(sql)}
		where e.family_id in (${householdIds(sql, familyId)}) ${schoolYear ? sql`and e.school_year = ${schoolYear}` : sql``}
		order by coalesce(e.due_on, e.posted_on), e.created_at, case when e.kind = 'charge' or e.direction = 'debit' then 0 else 1 end, e.id`;
	return rows.map(mapEntry);
}

export async function getEntry(id: string): Promise<LedgerEntry | null> {
	await dbReady();
	const sql = db();
	const [row] = await sql`${ENTRY_SELECT(sql)} where e.id = ${id}`;
	return row ? mapEntry(row) : null;
}

/** School years a household has billing in, newest first. */
export async function billingYears(familyId: string): Promise<string[]> {
	await dbReady();
	const sql = db();
	const rows = await sql`
		select school_year from finance_entries where family_id in (${householdIds(sql, familyId)})
		union select school_year from finance_plans where family_id in (${householdIds(sql, familyId)})
		order by 1 desc`;
	return rows.map((row) => String(row.school_year));
}

export type LedgerLine = LedgerEntry & { label: string; runningCents: number; signedCents: number };
export type HouseholdLedger = { lines: LedgerLine[]; balance: BillingBalance; installments: Installment[]; nextDue: Installment | null };

/** One household's year: entries with a running balance (voids don't count), totals, and the schedule. */
export async function householdLedger(familyId: string, schoolYear: string, today = chicagoToday()): Promise<HouseholdLedger> {
	const entries = await listFamilyEntries(familyId, schoolYear);
	let running = 0;
	const lines = entries.map((entry) => {
		const signedCents = entrySign(entry) * entry.amountCents;
		if (!entry.voidedAt) running += signedCents;
		return { ...entry, label: entryLabel(entry), signedCents, runningCents: running };
	});
	const installments = installmentCoverage(entries, today);
	return { lines, balance: billingBalance(entries, today), installments, nextDue: installments.find((row) => row.status !== 'paid') ?? null };
}

export type BillingAccount = {
	familyId: string; familyName: string; students: string[]; hasAid: boolean;
	billedCents: number; paidCents: number; creditedCents: number; balanceCents: number; dueNowCents: number;
};

/** Every household with a plan or an entry in the year, with its totals. */
export async function listBillingAccounts(schoolYear: string, today = chicagoToday()): Promise<BillingAccount[]> {
	await dbReady();
	const sql = db();
	const [entries, plans] = await Promise.all([
		sql`select e.*, coalesce(f.merged_into_id, f.id) as root from finance_entries e join families f on f.id = e.family_id where e.school_year = ${schoolYear}`,
		sql`select p.*, coalesce(f.merged_into_id, f.id) as root, coalesce(nullif(c.name, ''), p.child_name) as name from finance_plans p join families f on f.id = p.family_id left join children c on c.id = p.child_id where p.school_year = ${schoolYear}`,
	]);
	const roots = [...new Set([...entries, ...plans].map((row) => String(row.root)))];
	if (!roots.length) return [];
	const families = await sql`select id, name, email from families where id in ${sql(roots)}`;
	const names = new Map(families.map((row) => [String(row.id), String(row.name || row.email)]));
	return roots.map((root) => {
		const mine = plans.filter((row) => String(row.root) === root);
		const balance = billingBalance(entries.filter((row) => String(row.root) === root).map(mapEntry), today);
		return {
			familyId: root, familyName: names.get(root) ?? '',
			students: mine.filter((row) => row.status !== 'closed').map((row) => String(row.name || '')).filter(Boolean),
			hasAid: mine.some((row) => row.status !== 'closed' && (row.discounts as { kind: string }[]).some((discount) => discount.kind === 'assistance')),
			...balance,
		};
	}).sort((a, b) => a.familyName.localeCompare(b.familyName));
}

export type PaymentRow = LedgerEntry & { familyName: string };

/** Payments and refunds posted in a date range (a deposit view), oldest first. Voided ones included, marked. */
export async function listBillingPayments(from: string, to: string): Promise<PaymentRow[]> {
	await dbReady();
	const sql = db();
	const result = await sql`
		select e.*, coalesce(nullif(c.name, ''), p.child_name, '') as child_name, coalesce(nullif(f.name, ''), f.email) as family_name
		from finance_entries e join families f on f.id = e.family_id left join children c on c.id = e.child_id left join finance_plans p on p.id = e.plan_id
		where e.kind in ('payment', 'refund') and e.posted_on between ${from} and ${to}
		order by e.posted_on, e.created_at`;
	return result.map((row) => ({ ...mapEntry(row), familyName: String(row.family_name) }));
}

// ---- Rate card ----

function mapRateCard(row: Record<string, any>): RateCard {
	return {
		id: String(row.id), schoolYear: String(row.school_year), scenarioId: row.scenario_id ? String(row.scenario_id) : null,
		tiers: (row.tiers as RateTier[]).map((tier) => ({ label: String(tier.label), tuitionCents: Number(tier.tuitionCents) || 0, grades: Array.isArray(tier.grades) ? tier.grades.map(String) : gradesFromTierLabel(String(tier.label)) })),
		fees: (row.fees as RateFee[]).map((fee) => ({ label: String(fee.label), amountCents: Number(fee.amountCents) || 0 })),
		publishedAt: iso(row.published_at), publishedBy: String(row.published_by ?? ''),
	};
}

export async function getRateCard(schoolYear: string): Promise<RateCard | null> {
	await dbReady();
	const [row] = await db()`select * from finance_rate_cards where school_year = ${schoolYear}`;
	return row ? mapRateCard(row) : null;
}

/** Write a year's rate card. Existing plans keep their rates until someone reprices them. */
export async function saveRateCard(input: { schoolYear: string; scenarioId?: string | null; tiers: { label: string; tuitionCents: number; grades?: string[] }[]; fees: RateFee[]; by: string }): Promise<Result<{ card: RateCard }>> {
	await dbReady();
	if (!input.schoolYear) return { ok: false, error: 'Choose a school year.' };
	const tiers = input.tiers.filter((tier) => tier.label.trim()).map((tier) => ({ label: tier.label.trim(), tuitionCents: Math.max(0, Math.round(tier.tuitionCents)), grades: tier.grades?.length ? tier.grades : gradesFromTierLabel(tier.label) }));
	if (!tiers.length) return { ok: false, error: 'The rates need at least one tuition tier.' };
	const fees = input.fees.filter((fee) => fee.label.trim() && fee.amountCents > 0).map((fee) => ({ label: fee.label.trim(), amountCents: Math.round(fee.amountCents) }));
	const sql = db();
	const [row] = await sql`
		insert into finance_rate_cards (id, school_year, scenario_id, tiers, fees, published_at, published_by)
		values (${randomUUID()}, ${input.schoolYear}, ${input.scenarioId || null}, ${sql.json(tiers)}, ${sql.json(fees)}, now(), ${input.by})
		on conflict (school_year) do update set scenario_id = excluded.scenario_id, tiers = excluded.tiers, fees = excluded.fees, published_at = now(), published_by = excluded.published_by
		returning *`;
	return { ok: true, card: mapRateCard(row) };
}

/** The year's primary budget scenario, if the budget has one. */
export async function billingPrimaryScenario(schoolYear: string): Promise<{ id: string; name: string } | null> {
	return primaryScenario(schoolYear);
}

/** "Use these rates for billing": copy the primary budget scenario's tiers and fees onto the year's rate card. */
export async function publishRateCard(schoolYear: string, by: string): Promise<Result<{ card: RateCard }>> {
	const scenario = await primaryScenario(schoolYear);
	if (!scenario) return { ok: false, error: `There’s no primary budget for ${schoolYear} yet. Mark one scenario as primary on the Budget page first.` };
	const rates = await scenarioRates(scenario.id);
	return saveRateCard({ schoolYear, scenarioId: scenario.id, tiers: rates.tiers, fees: rates.fees.map((fee) => ({ label: fee.label, amountCents: fee.amountCents })), by });
}

// ---- Books mapping and settings ----

export async function getBooksAccounts(): Promise<Record<string, string>> {
	await dbReady();
	const rows = await db()`select category, account from finance_books_accounts`;
	return Object.fromEntries(rows.map((row) => [String(row.category), String(row.account)]));
}

export async function saveBooksAccounts(accounts: Record<string, string>): Promise<Result> {
	await dbReady();
	const sql = db();
	for (const category of entryCategories) {
		if (!(category in accounts)) continue;
		await sql`insert into finance_books_accounts (category, account) values (${category}, ${accounts[category].trim().slice(0, 120)})
			on conflict (category) do update set account = excluded.account`;
	}
	return { ok: true };
}

export type BillingSettings = { defaultSchedule: BillingSchedule; payableTo: string; howToPay: string };
const SETTINGS_KEY = 'finance_billing';
const DEFAULT_SETTINGS: BillingSettings = { defaultSchedule: 'ten_month', payableTo: 'Trinity Classical Academy', howToPay: '' };

export async function getBillingSettings(): Promise<BillingSettings> {
	const stored = await readSetting<Partial<BillingSettings>>(SETTINGS_KEY);
	const merged = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
	if (!(billingSchedules as readonly string[]).includes(merged.defaultSchedule)) merged.defaultSchedule = 'ten_month';
	return merged;
}

export async function saveBillingSettings(input: Partial<BillingSettings>): Promise<Result> {
	const current = await getBillingSettings();
	const next = { ...current, ...input };
	if (!(billingSchedules as readonly string[]).includes(next.defaultSchedule)) return { ok: false, error: 'Choose a default schedule.' };
	await writeSetting(SETTINGS_KEY, { defaultSchedule: next.defaultSchedule, payableTo: next.payableTo.trim().slice(0, 200), howToPay: next.howToPay.trim().slice(0, 4000) });
	return { ok: true };
}

// ---- Budget vs actuals ----

export type BillingActuals = { tuitionBilledCents: number; feesBilledCents: number; discountsByKind: Record<'faculty' | 'family' | 'assistance' | 'other', number>; collectedCents: number };

/** Billed and collected for a year, from the ledger, in the budget's terms. */
export async function billingActuals(schoolYear: string): Promise<BillingActuals> {
	await dbReady();
	const rows = await db()`select kind, direction, category, amount_cents from finance_entries where school_year = ${schoolYear} and voided_at is null`;
	const out: BillingActuals = { tuitionBilledCents: 0, feesBilledCents: 0, discountsByKind: { faculty: 0, family: 0, assistance: 0, other: 0 }, collectedCents: 0 };
	const kindOf: Record<string, keyof BillingActuals['discountsByKind']> = { faculty_discount: planDiscountBudgetKind.faculty, family_discount: 'family', tuition_assistance: 'assistance', other_credit: 'other' };
	for (const row of rows) {
		const amount = Number(row.amount_cents);
		const sign = entrySign({ kind: row.kind, direction: row.direction });
		if (row.kind === 'payment') out.collectedCents += amount;
		else if (row.kind === 'refund') out.collectedCents -= amount;
		else if (row.category === 'tuition') out.tuitionBilledCents += sign * amount;
		else if (chargeCategories.includes(row.category)) out.feesBilledCents += sign * amount;
		else if (kindOf[row.category]) out.discountsByKind[kindOf[row.category]] -= sign * amount;
	}
	return out;
}

export type BillingHousehold = { id: string; name: string; email: string; children: { id: string; name: string; grade: string }[] };

/** A household for the Finance pages (following a merge), with its students for plan pickers. */
export async function billingHousehold(familyId: string): Promise<BillingHousehold | null> {
	await dbReady();
	const sql = db();
	const [family] = await sql`select id, name, email from families where id = (select coalesce(m.merged_into_id, m.id) from families m where m.id = ${familyId})`;
	if (!family) return null;
	const children = await sql`select id, name, grade from children where family_id = ${family.id} order by position, name`;
	return {
		id: String(family.id), name: String(family.name || family.email), email: String(family.email),
		children: children.map((row) => ({ id: String(row.id), name: String(row.name), grade: String(row.grade) })),
	};
}
