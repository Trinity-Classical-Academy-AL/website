// Billing: tuition plans. Activating a plan writes its scheduled charges and credits to the ledger.
import { randomUUID } from 'node:crypto';
import { db, dbReady, type Sql } from '../db.ts';
import { logFamilyActivity } from '../family-merge.ts';
import type { Result } from '../result.ts';
import { chicagoToday } from '../time.ts';
import { getBillingSettings, getRateCard, insertEntry } from './billing-ledger.ts';
import {
	billingSchedules, defaultFirstDue, entrySign, planDiscountKinds, planLines, tierForGrade,
	type BillingSchedule, type Plan, type PlanDiscount, type PlanFee, type ScheduledLine,
} from './billing-model.ts';

type Tx = Sql;
const iso = (value: unknown) => value ? new Date(value as string).toISOString() : '';

const PLAN_SELECT = (sql: Sql | Tx) => sql`
	select p.*, coalesce(nullif(c.name, ''), p.child_name) as child_label, coalesce(nullif(f.name, ''), f.email) as family_name
	from finance_plans p join families f on f.id = p.family_id left join children c on c.id = p.child_id`;

function mapPlan(row: Record<string, any>): Plan {
	return {
		id: String(row.id), familyId: String(row.family_id), familyName: String(row.family_name ?? ''),
		childId: row.child_id ? String(row.child_id) : null, childName: String(row.child_label ?? row.child_name ?? ''),
		schoolYear: String(row.school_year), tier: String(row.tier), tuitionCents: Number(row.tuition_cents), schedule: row.schedule,
		firstDueOn: row.first_due_on ?? null, fees: (row.fees ?? []) as PlanFee[], discounts: (row.discounts ?? []) as PlanDiscount[],
		status: row.status, createdBy: String(row.created_by ?? ''), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
	};
}

export async function listPlans(schoolYear: string): Promise<Plan[]> {
	await dbReady();
	const sql = db();
	const rows = await sql`${PLAN_SELECT(sql)} where p.school_year = ${schoolYear} order by family_name, child_label`;
	return rows.map(mapPlan);
}

/** A household's plans for a year (including any household merged into it). */
export async function listFamilyPlans(familyId: string, schoolYear: string): Promise<Plan[]> {
	await dbReady();
	const sql = db();
	const rows = await sql`${PLAN_SELECT(sql)}
		where p.school_year = ${schoolYear} and p.family_id in (select id from families where id = ${familyId} or merged_into_id = ${familyId})
		order by child_label`;
	return rows.map(mapPlan);
}

export async function getPlan(id: string): Promise<Plan | null> {
	await dbReady();
	const sql = db();
	const [row] = await sql`${PLAN_SELECT(sql)} where p.id = ${id}`;
	return row ? mapPlan(row) : null;
}

export type PlanInput = {
	id?: string; familyId: string; childId: string | null; schoolYear: string; tier: string; tuitionCents: number;
	schedule: BillingSchedule; firstDueOn: string | null; fees: PlanFee[]; discounts: PlanDiscount[];
};

function cleanPlan(input: PlanInput): Result<{ plan: PlanInput }> {
	const fields: Record<string, string> = {};
	if (!input.familyId) fields.familyId = 'Choose a family';
	if (!input.schoolYear) fields.schoolYear = 'Choose a school year';
	if (!(billingSchedules as readonly string[]).includes(input.schedule)) fields.schedule = 'Choose a schedule';
	if (!Number.isInteger(input.tuitionCents) || input.tuitionCents < 0) fields.tuition = 'Enter the tuition';
	if (input.firstDueOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.firstDueOn)) fields.firstDueOn = 'Enter a date';
	const discounts = input.discounts.filter((discount) => (planDiscountKinds as readonly string[]).includes(discount.kind) && ((discount.amountCents ?? 0) > 0 || (discount.pctBps ?? 0) > 0))
		.map((discount) => ({ kind: discount.kind, label: discount.label.trim().slice(0, 120), ...(discount.pctBps && discount.pctBps > 0 ? { pctBps: Math.min(10000, Math.round(discount.pctBps)) } : { amountCents: Math.round(discount.amountCents ?? 0) }) }));
	const fees = input.fees.filter((fee) => fee.label.trim() && fee.amountCents > 0).map((fee) => ({ label: fee.label.trim().slice(0, 120), amountCents: Math.round(fee.amountCents), ...(fee.dueOn ? { dueOn: fee.dueOn } : {}) }));
	if (Object.keys(fields).length) return { ok: false, error: `Fix ${Object.keys(fields).length === 1 ? 'the field' : 'the fields'} to save.`, fields };
	return { ok: true, plan: { ...input, tier: input.tier.trim().slice(0, 120), discounts, fees } };
}

const PLAN_VOIDS = ['Plan changed', 'Plan closed'];
const lineKey = (line: { kind: string; category: string; amountCents: number; dueOn: string | null; memo: string }) => `${line.kind}|${line.category}|${line.amountCents}|${line.dueOn}|${line.memo}`;
const signedLine = (line: { kind: 'charge' | 'credit' | string; amountCents: number }) => (line.kind === 'charge' ? 1 : -1) * line.amountCents;

/**
 * Bring an active plan's ledger in line with the plan. Only future scheduled entries are replaced
 * (the old ones are voided, never deleted). Installments already due stay; any difference becomes one adjustment.
 */
async function syncPlanLedger(tx: Tx, plan: Plan, today: string, by: string, initial = false): Promise<void> {
	// Activation writes the whole schedule, including installments whose dates have already passed.
	if (initial) {
		for (const line of planLines(plan, today)) await insertLine(tx, plan, line, by);
		return;
	}
	const desired = plan.status === 'active' ? planLines(plan, today) : [];
	const all = await tx`select * from finance_entries where plan_id = ${plan.id} and scheduled`;
	const existing = all.filter((row) => !row.voided_at);
	// A scheduled entry staff voided by hand still counts as "already charged", so a plan change doesn't bring it back.
	const handVoided = all.filter((row) => row.voided_at && !PLAN_VOIDS.includes(String(row.void_reason)));
	const isPast = (dueOn: string | null) => !!dueOn && dueOn <= today;
	const futureExisting = existing.filter((row) => !isPast(row.due_on));
	const futureDesired = desired.filter((line) => !isPast(line.dueOn));
	const same = futureExisting.map((row) => lineKey({ kind: row.kind, category: row.category, amountCents: Number(row.amount_cents), dueOn: row.due_on, memo: row.memo })).sort().join('\n')
		=== futureDesired.map(lineKey).sort().join('\n');
	if (!same) {
		if (futureExisting.length) {
			await tx`update finance_entries set voided_at = now(), voided_by = ${by}, void_reason = ${plan.status === 'closed' ? 'Plan closed' : 'Plan changed'}
				where id in ${tx(futureExisting.map((row) => String(row.id)))}`;
		}
		for (const line of futureDesired) await insertLine(tx, plan, line, by);
	}
	// Installments already due keep their entries; a closed plan keeps them too.
	if (plan.status !== 'active') return;
	const pastExisting = [...existing, ...handVoided].filter((row) => isPast(row.due_on)).reduce((sum, row) => sum + entrySign({ kind: row.kind, direction: row.direction }) * Number(row.amount_cents), 0);
	const pastAdjusted = (await tx`select kind, direction, amount_cents from finance_entries where plan_id = ${plan.id} and kind = 'adjustment' and not scheduled and voided_at is null and memo like 'Plan change%'`)
		.reduce((sum, row) => sum + entrySign({ kind: row.kind, direction: row.direction }) * Number(row.amount_cents), 0);
	const pastDesired = desired.filter((line) => isPast(line.dueOn)).reduce((sum, line) => sum + signedLine(line), 0);
	const diff = pastDesired - pastExisting - pastAdjusted;
	if (diff !== 0) {
		await insertEntry(tx, {
			familyId: plan.familyId, childId: plan.childId, planId: plan.id, schoolYear: plan.schoolYear, kind: 'adjustment',
			direction: diff > 0 ? 'debit' : 'credit', category: diff > 0 ? 'tuition' : 'other_credit', amountCents: Math.abs(diff),
			dueOn: today, postedOn: today, memo: 'Plan change: installments already due',
		}, by);
	}
}

async function insertLine(tx: Tx, plan: Plan, line: ScheduledLine, by: string) {
	const result = await insertEntry(tx, {
		familyId: plan.familyId, childId: plan.childId, planId: plan.id, schoolYear: plan.schoolYear, kind: line.kind, category: line.category,
		amountCents: line.amountCents, dueOn: line.dueOn, postedOn: line.dueOn, scheduled: true, memo: line.memo,
	}, by);
	if (!result.ok) throw new Error(result.error);
}

async function loadForUpdate(tx: Tx, id: string): Promise<Plan | null> {
	const [locked] = await tx`select id from finance_plans where id = ${id} for update`;
	if (!locked) return null;
	const [row] = await tx`${PLAN_SELECT(tx)} where p.id = ${id}`;
	return row ? mapPlan(row) : null;
}

/** Create a draft plan, or change one. Changing an active plan regenerates its future scheduled entries. */
export async function savePlan(input: PlanInput, by: string, today = chicagoToday()): Promise<Result<{ id: string }>> {
	await dbReady();
	const checked = cleanPlan(input);
	if (!checked.ok) return checked;
	const plan = checked.plan;
	const sql = db();
	if (!plan.id) {
		const [family] = await sql`select coalesce(merged_into_id, id) as id from families where id = ${plan.familyId}`;
		if (!family) return { ok: false, error: 'That family no longer exists.' };
		const child = plan.childId ? (await sql`select id, name from children where id = ${plan.childId}`)[0] : null;
		if (plan.childId && !child) return { ok: false, error: 'That student no longer exists.' };
		if (plan.childId && (await sql`select 1 from finance_plans where child_id = ${plan.childId} and school_year = ${plan.schoolYear}`).length) {
			return { ok: false, error: 'That student already has a plan for this year.' };
		}
		const id = randomUUID();
		await sql`
			insert into finance_plans (id, family_id, child_id, child_name, school_year, tier, tuition_cents, schedule, first_due_on, fees, discounts, created_by)
			values (${id}, ${String(family.id)}, ${plan.childId}, ${String(child?.name ?? '')}, ${plan.schoolYear}, ${plan.tier}, ${plan.tuitionCents}, ${plan.schedule},
				${plan.firstDueOn || defaultFirstDue(plan.schoolYear, plan.schedule)}, ${sql.json(plan.fees)}, ${sql.json(plan.discounts as never)}, ${by})`;
		return { ok: true, id };
	}
	const saved = await sql.begin(async (transaction) => {
		const tx = transaction as unknown as Tx;
		const current = await loadForUpdate(tx, plan.id!);
		if (!current) return { ok: false as const, error: 'That plan no longer exists.' };
		if (current.status === 'closed') return { ok: false as const, error: 'This plan is closed. Its entries stay on the ledger.' };
		// An active plan keeps the fee dates it was charged with.
		const fees = current.status === 'active' ? plan.fees.map((fee) => ({ ...fee, dueOn: fee.dueOn || today })) : plan.fees;
		const [row] = await tx`
			update finance_plans set tier = ${plan.tier}, tuition_cents = ${plan.tuitionCents}, schedule = ${plan.schedule},
				first_due_on = ${plan.firstDueOn || defaultFirstDue(plan.schoolYear, plan.schedule)}, fees = ${tx.json(fees)}, discounts = ${tx.json(plan.discounts as never)}, updated_at = now()
			where id = ${plan.id!} returning id`;
		if (current.status === 'active') {
			const next = await loadForUpdate(tx, String(row.id));
			await syncPlanLedger(tx, next!, today, by);
		}
		return { ok: true as const, id: String(row.id), current };
	});
	if (!saved.ok) return saved;
	// Logged after the transaction: the pool has one connection.
	if (saved.current.status === 'active') await logFamilyActivity(saved.current.familyId, 'note', by, `Tuition plan changed${saved.current.childName ? ` for ${saved.current.childName}` : ''} (${saved.current.schoolYear})`);
	return { ok: true, id: saved.id };
}

/** Draft → active: write the plan's scheduled charges and credits to the ledger. */
export async function activatePlan(id: string, by: string, today = chicagoToday()): Promise<Result<{ id: string }>> {
	await dbReady();
	const result = await db().begin(async (transaction) => {
		const tx = transaction as unknown as Tx;
		const plan = await loadForUpdate(tx, id);
		if (!plan) return { ok: false as const, error: 'That plan no longer exists.' };
		if (plan.status !== 'draft') return { ok: false as const, error: plan.status === 'active' ? 'This plan is already active.' : 'This plan is closed.' };
		if (plan.tuitionCents <= 0 && !plan.fees.length) return { ok: false as const, error: 'Set the tuition before activating the plan.' };
		// Fees without a date of their own are due the day the plan starts, and keep that date.
		const fees = plan.fees.map((fee) => ({ ...fee, dueOn: fee.dueOn || today }));
		await tx`update finance_plans set status = 'active', fees = ${tx.json(fees)}, updated_at = now() where id = ${id}`;
		await syncPlanLedger(tx, { ...plan, fees, status: 'active' }, today, by, true);
		return { ok: true as const, id, plan };
	});
	if (!result.ok) return result;
	await logFamilyActivity(result.plan.familyId, 'note', by, `Tuition plan started${result.plan.childName ? ` for ${result.plan.childName}` : ''} (${result.plan.schoolYear})`);
	return { ok: true, id };
}

/** Active → closed (withdrew or graduated): future scheduled entries are voided; what was already due stays. */
export async function closePlan(id: string, by: string, today = chicagoToday()): Promise<Result<{ id: string }>> {
	await dbReady();
	const result = await db().begin(async (transaction) => {
		const tx = transaction as unknown as Tx;
		const plan = await loadForUpdate(tx, id);
		if (!plan) return { ok: false as const, error: 'That plan no longer exists.' };
		if (plan.status === 'closed') return { ok: false as const, error: 'This plan is already closed.' };
		await tx`update finance_plans set status = 'closed', updated_at = now() where id = ${id}`;
		if (plan.status === 'active') await syncPlanLedger(tx, { ...plan, status: 'closed' }, today, by);
		return { ok: true as const, id, plan };
	});
	if (!result.ok) return result;
	await logFamilyActivity(result.plan.familyId, 'note', by, `Tuition plan closed${result.plan.childName ? ` for ${result.plan.childName}` : ''} (${result.plan.schoolYear})`);
	return { ok: true, id };
}

/** Take the plan's tier tuition from the year's current rate card. */
export async function repricePlan(id: string, by: string, today = chicagoToday()): Promise<Result<{ id: string }>> {
	const plan = await getPlan(id);
	if (!plan) return { ok: false, error: 'That plan no longer exists.' };
	const card = await getRateCard(plan.schoolYear);
	const tier = card?.tiers.find((row) => row.label === plan.tier);
	if (!tier) return { ok: false, error: card ? `The ${plan.schoolYear} rates have no “${plan.tier}” tier. Pick a tier on the plan instead.` : `Publish the ${plan.schoolYear} rates first.` };
	if (tier.tuitionCents === plan.tuitionCents) return { ok: true, id };
	return savePlan({ ...plan, tuitionCents: tier.tuitionCents }, by, today);
}

/**
 * "Create plans for enrolled students": a draft for every enrolled child in the year who has no plan,
 * with the tier from their grade, the rate card's fees and the default schedule.
 */
export async function createDraftPlans(schoolYear: string, by: string): Promise<Result<{ created: number; unmatched: number }>> {
	await dbReady();
	const card = await getRateCard(schoolYear);
	if (!card) return { ok: false, error: `Publish the ${schoolYear} rates first (Finance settings).` };
	const settings = await getBillingSettings();
	const sql = db();
	const rows = await sql`
		select c.id, c.name, coalesce(nullif(e.grade, ''), c.grade) as grade, coalesce(f.merged_into_id, f.id) as family_id
		from enrollments e join children c on c.id = e.child_id join families f on f.id = c.family_id
		where e.school_year = ${schoolYear} and e.status = 'enrolled'
			and not exists (select 1 from finance_plans p where p.child_id = c.id and p.school_year = ${schoolYear})`;
	let unmatched = 0;
	for (const row of rows) {
		const tier = tierForGrade(card.tiers, String(row.grade));
		if (!tier) unmatched += 1;
		await sql`
			insert into finance_plans (id, family_id, child_id, child_name, school_year, tier, tuition_cents, schedule, first_due_on, fees, discounts, created_by)
			values (${randomUUID()}, ${String(row.family_id)}, ${String(row.id)}, ${String(row.name)}, ${schoolYear}, ${tier?.label ?? ''}, ${tier?.tuitionCents ?? 0},
				${settings.defaultSchedule}, ${defaultFirstDue(schoolYear, settings.defaultSchedule)}, ${sql.json(card.fees)}, ${sql.json([])}, ${by})
			on conflict do nothing`;
	}
	return { ok: true, created: rows.length, unmatched };
}

/** Activate every draft plan in the year that has tuition set. */
export async function activateDraftPlans(schoolYear: string, by: string, today = chicagoToday()): Promise<Result<{ activated: number; skipped: number }>> {
	await dbReady();
	const drafts = await db()`select id from finance_plans where school_year = ${schoolYear} and status = 'draft'`;
	let activated = 0;
	for (const row of drafts) if ((await activatePlan(String(row.id), by, today)).ok) activated += 1;
	return { ok: true, activated, skipped: drafts.length - activated };
}
