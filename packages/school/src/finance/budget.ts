// Budget (proforma): scenarios, lines, staff, the calculation. Exports re-exported from @tca/school.
import { randomUUID } from 'node:crypto';
import { db, dbReady } from '../db.ts';
import type { Result } from '../result.ts';
import {
	budgetDiscountKinds, budgetRateRules, budgetRules, budgetSections, budgetStaffGroups, computeBudget, growByBps,
	type BudgetDiscountKind, type BudgetFee, type BudgetInput, type BudgetLine, type BudgetRule, type BudgetSection,
	type BudgetSettings, type BudgetStaff, type BudgetStaffGroup, type BudgetStatement, type BudgetTier,
} from './compute.ts';

export * from './compute.ts';

type Row = Record<string, unknown>;
const num = (value: unknown) => Number(value ?? 0);
const str = (value: unknown) => String(value ?? '');

export type BudgetScenarioSummary = { id: string; name: string; schoolYear: string; primary: boolean };
export type BudgetScenario = BudgetScenarioSummary & {
	notes: string;
	updatedAt: string;
	settings: BudgetSettings;
	tiers: (BudgetTier & { id: string })[];
	fees: (BudgetFee & { id: string })[];
	staff: (BudgetStaff & { id: string })[];
	lines: (BudgetLine & { id: string })[];
};

const summary = (row: Row): BudgetScenarioSummary => ({ id: str(row.id), name: str(row.name), schoolYear: str(row.school_year), primary: Boolean(row.is_primary) });
const settingsOf = (row: Row): BudgetSettings => ({
	subRateBps: num(row.sub_rate_bps),
	payrollTaxBps: num(row.payroll_tax_bps),
	medicalCents: num(row.medical_cents),
	retirementCents: num(row.retirement_cents),
	churchDonationCents: num(row.church_donation_cents),
});
const tierOf = (row: Row) => ({ id: str(row.id), label: str(row.label), tuitionCents: num(row.tuition_cents), students: num(row.students) });
const feeOf = (row: Row) => ({ id: str(row.id), label: str(row.label), amountCents: num(row.amount_cents), students: row.students === null ? null : num(row.students) });
const staffOf = (row: Row) => ({ id: str(row.id), name: str(row.name), group: str(row.staff_group) as BudgetStaffGroup, role: str(row.role), payCents: num(row.pay_cents), onPayroll: Boolean(row.on_payroll) });
const lineOf = (row: Row) => ({
	id: str(row.id),
	section: str(row.section) as BudgetSection,
	kind: row.kind ? (str(row.kind) as BudgetDiscountKind) : null,
	label: str(row.label),
	rule: str(row.rule) as BudgetRule,
	amountCents: num(row.amount_cents),
	rateBps: num(row.rate_bps),
	count: num(row.count),
	tierId: row.tier_id ? str(row.tier_id) : null,
	note: str(row.note),
});

/** Every scenario by school year, the primary one first within its year. */
export async function listScenarios(): Promise<BudgetScenarioSummary[]> {
	await dbReady();
	const rows = await db()`select id, name, school_year, is_primary from budget_scenarios order by school_year, is_primary desc, created_at, name`;
	return rows.map(summary);
}

export async function primaryScenario(schoolYear: string): Promise<{ id: string; name: string } | null> {
	await dbReady();
	const [row] = await db()`select id, name from budget_scenarios where school_year = ${schoolYear} and is_primary limit 1`;
	return row ? { id: str(row.id), name: str(row.name) } : null;
}

/** The tuition tiers and fees a scenario budgets, for rate cards. */
export async function scenarioRates(scenarioId: string): Promise<{ tiers: { label: string; tuitionCents: number; students: number }[]; fees: { label: string; amountCents: number }[] }> {
	await dbReady();
	if (!validId(scenarioId)) return { tiers: [], fees: [] };
	const [tiers, fees] = await Promise.all([
		db()`select label, tuition_cents, students from budget_tiers where scenario_id = ${scenarioId} order by position, label`,
		db()`select label, amount_cents from budget_fees where scenario_id = ${scenarioId} order by position, label`,
	]);
	return {
		tiers: tiers.map((row) => ({ label: str(row.label), tuitionCents: num(row.tuition_cents), students: num(row.students) })),
		fees: fees.map((row) => ({ label: str(row.label), amountCents: num(row.amount_cents) })),
	};
}

const validId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/** Load scenarios with everything they hold (all of them when no ids are given). */
async function loadScenarios(ids?: string[]): Promise<BudgetScenario[]> {
	await dbReady();
	const sql = db();
	const scenarios = ids
		? await sql`select * from budget_scenarios where id in ${sql(ids)} order by school_year, is_primary desc, created_at, name`
		: await sql`select * from budget_scenarios order by school_year, is_primary desc, created_at, name`;
	if (!scenarios.length) return [];
	const keys = scenarios.map((row) => str(row.id));
	const [tiers, fees, staff, lines] = await Promise.all([
		sql`select * from budget_tiers where scenario_id in ${sql(keys)} order by position, label`,
		sql`select * from budget_fees where scenario_id in ${sql(keys)} order by position, label`,
		sql`select * from budget_staff where scenario_id in ${sql(keys)} order by position, name`,
		sql`select * from budget_lines where scenario_id in ${sql(keys)} order by position, label`,
	]);
	const of = (rows: Row[], id: string) => rows.filter((row) => str(row.scenario_id) === id);
	return scenarios.map((row) => {
		const id = str(row.id);
		return {
			...summary(row),
			notes: str(row.notes),
			updatedAt: new Date(row.updated_at as string).toISOString(),
			settings: settingsOf(row),
			tiers: of(tiers, id).map(tierOf),
			fees: of(fees, id).map(feeOf),
			staff: of(staff, id).map(staffOf),
			lines: of(lines, id).map(lineOf),
		};
	});
}

export async function getScenario(id: string): Promise<BudgetScenario | null> {
	if (!validId(id)) return null;
	return (await loadScenarios([id]))[0] ?? null;
}

export const scenarioInput = (scenario: BudgetScenario): BudgetInput => ({ tiers: scenario.tiers, fees: scenario.fees, staff: scenario.staff, lines: scenario.lines, settings: scenario.settings });

/** Every scenario with its computed statement, for Compare. */
export async function scenarioStatements(): Promise<(BudgetScenarioSummary & { statement: BudgetStatement })[]> {
	const scenarios = await loadScenarios();
	return scenarios.map((scenario) => ({ id: scenario.id, name: scenario.name, schoolYear: scenario.schoolYear, primary: scenario.primary, statement: computeBudget(scenarioInput(scenario)) }));
}

/** A failed save: the message lists each field's problem, and `fields` marks them. */
const invalid = (fields: Record<string, string>) => ({ ok: false as const, error: Object.values(fields).join(' '), fields });

const SCHOOL_YEAR = /^\d{4}[–-]\d{2}$/;
const normalYear = (year: string) => year.trim().replace('-', '–');

async function nameTaken(name: string, exceptId = ''): Promise<boolean> {
	const rows = await db()`select id from budget_scenarios where lower(name) = lower(${name}) and id::text <> ${exceptId}`;
	return rows.length > 0;
}

function checkScenario(input: { name: string; schoolYear: string }) {
	const fields: Record<string, string> = {};
	if (!input.name.trim()) fields.name = 'Give the budget a name.';
	if (!SCHOOL_YEAR.test(normalYear(input.schoolYear))) fields.schoolYear = 'Use a school year like 2026–27.';
	return fields;
}

async function touch(scenarioId: string) {
	await db()`update budget_scenarios set updated_at = now() where id = ${scenarioId}`;
}

export async function createScenario(input: { name: string; schoolYear: string; notes?: string }): Promise<Result<{ id: string }>> {
	await dbReady();
	const fields = checkScenario(input);
	if (Object.keys(fields).length) return invalid(fields);
	const name = input.name.trim();
	if (await nameTaken(name)) return { ok: false, error: 'Another budget already has that name.', fields: { name: 'Pick another name.' } };
	const id = randomUUID();
	const year = normalYear(input.schoolYear);
	await db()`
		insert into budget_scenarios (id, name, school_year, notes, is_primary)
		values (${id}, ${name}, ${year}, ${input.notes ?? ''}, not exists (select 1 from budget_scenarios where school_year = ${year} and is_primary))`;
	return { ok: true, id };
}

export async function updateScenario(input: { id: string; name: string; schoolYear: string; notes: string; churchDonationCents: number; primary: boolean }): Promise<Result<{ id: string }>> {
	await dbReady();
	if (!validId(input.id)) return { ok: false, error: 'That budget no longer exists.' };
	const fields = checkScenario(input);
	if (Object.keys(fields).length) return invalid(fields);
	const name = input.name.trim();
	if (await nameTaken(name, input.id)) return { ok: false, error: 'Another budget already has that name.', fields: { name: 'Pick another name.' } };
	const year = normalYear(input.schoolYear);
	await db().begin(async (tx) => {
		if (input.primary) await tx`update budget_scenarios set is_primary = false where school_year = ${year} and id <> ${input.id}`;
		await tx`
			update budget_scenarios set name = ${name}, school_year = ${year}, notes = ${input.notes}, church_donation_cents = ${input.churchDonationCents},
				is_primary = ${input.primary}, updated_at = now()
			where id = ${input.id}`;
	});
	return { ok: true, id: input.id };
}

export async function deleteScenario(id: string): Promise<Result> {
	await dbReady();
	if (!validId(id)) return { ok: false, error: 'That budget no longer exists.' };
	await db()`delete from budget_scenarios where id = ${id}`;
	return { ok: true };
}

export async function saveStaffSettings(input: { id: string; subRateBps: number; payrollTaxBps: number; medicalCents: number; retirementCents: number }): Promise<Result> {
	await dbReady();
	if (!validId(input.id)) return { ok: false, error: 'That budget no longer exists.' };
	if ([input.subRateBps, input.payrollTaxBps].some((bps) => bps < 0 || bps > 10000)) return { ok: false, error: 'Rates are between 0% and 100%.' };
	await db()`
		update budget_scenarios set sub_rate_bps = ${input.subRateBps}, payroll_tax_bps = ${input.payrollTaxBps},
			medical_cents = ${input.medicalCents}, retirement_cents = ${input.retirementCents}, updated_at = now()
		where id = ${input.id}`;
	return { ok: true };
}

/** The next position at the end of a scenario's table. */
async function nextPosition(table: 'budget_tiers' | 'budget_fees' | 'budget_staff' | 'budget_lines', scenarioId: string, section?: string): Promise<number> {
	const sql = db();
	const rows = section
		? await sql`select coalesce(max(position), -1) + 1 as n from budget_lines where scenario_id = ${scenarioId} and section = ${section}`
		: await sql`select coalesce(max(position), -1) + 1 as n from ${sql(table)} where scenario_id = ${scenarioId}`;
	return num(rows[0]?.n);
}

const missing = { ok: false as const, error: 'That budget no longer exists.' };
async function scenarioExists(id: string) {
	await dbReady();
	if (!validId(id)) return false;
	return (await db()`select 1 from budget_scenarios where id = ${id}`).length > 0;
}

export async function saveTier(input: { scenarioId: string; id?: string; label: string; tuitionCents: number; students: number }): Promise<Result<{ id: string }>> {
	if (!(await scenarioExists(input.scenarioId))) return missing;
	if (!input.label.trim()) return invalid({ label: 'Name the tier.' });
	if (input.students < 0 || input.tuitionCents < 0) return { ok: false, error: 'Tuition and students can’t be negative.' };
	const id = input.id && validId(input.id) ? input.id : randomUUID();
	if (input.id) await db()`update budget_tiers set label = ${input.label.trim()}, tuition_cents = ${input.tuitionCents}, students = ${input.students} where id = ${id} and scenario_id = ${input.scenarioId}`;
	else await db()`insert into budget_tiers (id, scenario_id, label, tuition_cents, students, position) values (${id}, ${input.scenarioId}, ${input.label.trim()}, ${input.tuitionCents}, ${input.students}, ${await nextPosition('budget_tiers', input.scenarioId)})`;
	await touch(input.scenarioId);
	return { ok: true, id };
}

export async function saveFee(input: { scenarioId: string; id?: string; label: string; amountCents: number; students: number | null }): Promise<Result<{ id: string }>> {
	if (!(await scenarioExists(input.scenarioId))) return missing;
	if (!input.label.trim()) return invalid({ label: 'Name the fee.' });
	if (input.amountCents < 0 || (input.students ?? 0) < 0) return { ok: false, error: 'Amounts and students can’t be negative.' };
	const id = input.id && validId(input.id) ? input.id : randomUUID();
	if (input.id) await db()`update budget_fees set label = ${input.label.trim()}, amount_cents = ${input.amountCents}, students = ${input.students} where id = ${id} and scenario_id = ${input.scenarioId}`;
	else await db()`insert into budget_fees (id, scenario_id, label, amount_cents, students, position) values (${id}, ${input.scenarioId}, ${input.label.trim()}, ${input.amountCents}, ${input.students}, ${await nextPosition('budget_fees', input.scenarioId)})`;
	await touch(input.scenarioId);
	return { ok: true, id };
}

export async function saveStaff(input: { scenarioId: string; id?: string; name: string; group: string; role: string; payCents: number; onPayroll: boolean }): Promise<Result<{ id: string }>> {
	if (!(await scenarioExists(input.scenarioId))) return missing;
	const fields: Record<string, string> = {};
	if (!input.name.trim()) fields.name = 'Enter a name.';
	if (!(budgetStaffGroups as readonly string[]).includes(input.group)) fields.group = 'Pick faculty or leadership.';
	if (input.payCents < 0) fields.pay = 'Pay can’t be negative.';
	if (Object.keys(fields).length) return invalid(fields);
	const id = input.id && validId(input.id) ? input.id : randomUUID();
	if (input.id) await db()`update budget_staff set name = ${input.name.trim()}, staff_group = ${input.group}, role = ${input.role.trim()}, pay_cents = ${input.payCents}, on_payroll = ${input.onPayroll} where id = ${id} and scenario_id = ${input.scenarioId}`;
	else await db()`insert into budget_staff (id, scenario_id, name, staff_group, role, pay_cents, on_payroll, position) values (${id}, ${input.scenarioId}, ${input.name.trim()}, ${input.group}, ${input.role.trim()}, ${input.payCents}, ${input.onPayroll}, ${await nextPosition('budget_staff', input.scenarioId)})`;
	await touch(input.scenarioId);
	return { ok: true, id };
}

export type BudgetLineInput = { scenarioId: string; id?: string; section: string; kind: string | null; label: string; rule: string; amountCents: number; rateBps: number; count: number; tierId: string | null; note: string };

function checkLine(input: BudgetLineInput) {
	const fields: Record<string, string> = {};
	if (!input.label.trim()) fields.label = 'Name the line.';
	if (!(budgetSections as readonly string[]).includes(input.section)) fields.section = 'Pick a section.';
	if (!(budgetRules as readonly string[]).includes(input.rule)) fields.rule = 'Pick a rule.';
	if (input.section === 'discounts' && !(budgetDiscountKinds as readonly string[]).includes(input.kind ?? '')) fields.kind = 'Pick a kind of discount.';
	if (input.amountCents < 0) fields.amount = 'Can’t be negative.';
	if (input.rateBps < 0 || input.rateBps > 10000) fields.rate = 'Between 0% and 100%.';
	if (input.count < 0) fields.count = 'Can’t be negative.';
	return fields;
}

export async function saveLine(input: BudgetLineInput): Promise<Result<{ id: string }>> {
	if (!(await scenarioExists(input.scenarioId))) return missing;
	const fields = checkLine(input);
	if (Object.keys(fields).length) return invalid(fields);
	const rate = budgetRateRules.has(input.rule as BudgetRule);
	const kind = input.section === 'discounts' ? input.kind : null;
	const tierId = input.rule === 'pct_tuition_count' && input.tierId && validId(input.tierId) ? input.tierId : null;
	const values = { label: input.label.trim(), amount: rate ? 0 : input.amountCents, rateBps: rate ? input.rateBps : 0, count: input.rule === 'pct_tuition_count' ? input.count : 0 };
	const id = input.id && validId(input.id) ? input.id : randomUUID();
	if (input.id) {
		await db()`
			update budget_lines set section = ${input.section}, kind = ${kind}, label = ${values.label}, rule = ${input.rule}, amount_cents = ${values.amount},
				rate_bps = ${values.rateBps}, count = ${values.count}, tier_id = ${tierId}, note = ${input.note.trim()}
			where id = ${id} and scenario_id = ${input.scenarioId}`;
	} else {
		await db()`
			insert into budget_lines (id, scenario_id, section, kind, label, rule, amount_cents, rate_bps, count, tier_id, note, position)
			values (${id}, ${input.scenarioId}, ${input.section}, ${kind}, ${values.label}, ${input.rule}, ${values.amount}, ${values.rateBps}, ${values.count}, ${tierId}, ${input.note.trim()}, ${await nextPosition('budget_lines', input.scenarioId, input.section)})`;
	}
	await touch(input.scenarioId);
	return { ok: true, id };
}

/** Remove one tier, fee, staff row or line from a scenario. */
export async function deleteBudgetItem(kind: 'tier' | 'fee' | 'staff' | 'line', scenarioId: string, id: string): Promise<Result> {
	if (!(await scenarioExists(scenarioId)) || !validId(id)) return missing;
	const sql = db();
	const table = ({ tier: 'budget_tiers', fee: 'budget_fees', staff: 'budget_staff', line: 'budget_lines' } as const)[kind];
	await sql`delete from ${sql(table)} where id = ${id} and scenario_id = ${scenarioId}`;
	await touch(scenarioId);
	return { ok: true };
}

/** A whole scenario as plain data. Lines name their tier by label. Used by duplicate and the import script. */
export type BudgetScenarioData = {
	name: string;
	schoolYear: string;
	notes?: string;
	primary?: boolean;
	settings: BudgetSettings;
	tiers: { label: string; tuitionCents: number; students: number }[];
	fees: { label: string; amountCents: number; students: number | null }[];
	staff: { name: string; group: BudgetStaffGroup; role?: string; payCents: number; onPayroll?: boolean }[];
	lines: { section: BudgetSection; kind?: BudgetDiscountKind | null; label: string; rule: BudgetRule; amountCents?: number; rateBps?: number; count?: number; tierLabel?: string | null; note?: string }[];
};

type Tx = Parameters<Parameters<ReturnType<typeof db>['begin']>[0]>[0];

async function insertScenario(tx: Tx, data: BudgetScenarioData): Promise<string> {
	const id = randomUUID();
	const year = normalYear(data.schoolYear);
	const s = data.settings;
	if (data.primary) await tx`update budget_scenarios set is_primary = false where school_year = ${year}`;
	await tx`
		insert into budget_scenarios (id, name, school_year, notes, is_primary, church_donation_cents, sub_rate_bps, payroll_tax_bps, medical_cents, retirement_cents)
		values (${id}, ${data.name.trim()}, ${year}, ${data.notes ?? ''},
			${data.primary ?? false} or not exists (select 1 from budget_scenarios where school_year = ${year} and is_primary),
			${s.churchDonationCents}, ${s.subRateBps}, ${s.payrollTaxBps}, ${s.medicalCents}, ${s.retirementCents})`;
	const tierIds = new Map<string, string>();
	for (const [position, tier] of data.tiers.entries()) {
		const tierId = randomUUID();
		tierIds.set(tier.label, tierId);
		await tx`insert into budget_tiers (id, scenario_id, label, tuition_cents, students, position) values (${tierId}, ${id}, ${tier.label}, ${tier.tuitionCents}, ${tier.students}, ${position})`;
	}
	for (const [position, fee] of data.fees.entries()) {
		await tx`insert into budget_fees (id, scenario_id, label, amount_cents, students, position) values (${randomUUID()}, ${id}, ${fee.label}, ${fee.amountCents}, ${fee.students}, ${position})`;
	}
	for (const [position, person] of data.staff.entries()) {
		await tx`insert into budget_staff (id, scenario_id, name, staff_group, role, pay_cents, on_payroll, position) values (${randomUUID()}, ${id}, ${person.name}, ${person.group}, ${person.role ?? ''}, ${person.payCents}, ${person.onPayroll ?? true}, ${position})`;
	}
	const positions = new Map<string, number>();
	for (const line of data.lines) {
		const position = positions.get(line.section) ?? 0;
		positions.set(line.section, position + 1);
		const tierId = line.tierLabel ? tierIds.get(line.tierLabel) ?? null : null;
		await tx`
			insert into budget_lines (id, scenario_id, section, kind, label, rule, amount_cents, rate_bps, count, tier_id, note, position)
			values (${randomUUID()}, ${id}, ${line.section}, ${line.section === 'discounts' ? line.kind ?? 'other' : null}, ${line.label}, ${line.rule},
				${line.amountCents ?? 0}, ${line.rateBps ?? 0}, ${line.count ?? 0}, ${tierId}, ${line.note ?? ''}, ${position})`;
	}
	return id;
}

const scenarioData = (scenario: BudgetScenario): BudgetScenarioData => ({
	name: scenario.name,
	schoolYear: scenario.schoolYear,
	notes: scenario.notes,
	settings: scenario.settings,
	tiers: scenario.tiers.map(({ label, tuitionCents, students }) => ({ label, tuitionCents, students })),
	fees: scenario.fees.map(({ label, amountCents, students }) => ({ label, amountCents, students })),
	staff: scenario.staff.map(({ name, group, role, payCents, onPayroll }) => ({ name, group, role, payCents, onPayroll })),
	lines: scenario.lines.map((line) => ({ ...line, tierLabel: scenario.tiers.find((tier) => tier.id === line.tierId)?.label ?? null })),
});

/**
 * Copy a scenario. Growth (basis points) is applied once and written as plain numbers:
 * to money lines, staff pay and tuition rates, each only when picked. Nothing stays linked.
 */
export async function duplicateScenario(input: { id: string; name: string; schoolYear: string; growthBps: number; growLines: boolean; growStaff: boolean; growTuition: boolean }): Promise<Result<{ id: string }>> {
	const source = await getScenario(input.id);
	if (!source) return missing;
	const fields = checkScenario(input);
	if (Object.keys(fields).length) return invalid(fields);
	if (await nameTaken(input.name.trim())) return { ok: false, error: 'Another budget already has that name.', fields: { name: 'Pick another name.' } };
	const g = (cents: number, on: boolean) => on ? growByBps(cents, input.growthBps) : cents;
	const data = scenarioData(source);
	const copy: BudgetScenarioData = {
		...data,
		name: input.name.trim(),
		schoolYear: input.schoolYear,
		primary: false,
		tiers: data.tiers.map((tier) => ({ ...tier, tuitionCents: g(tier.tuitionCents, input.growTuition) })),
		staff: data.staff.map((person) => ({ ...person, payCents: g(person.payCents, input.growStaff) })),
		lines: data.lines.map((line) => ({ ...line, amountCents: g(line.amountCents ?? 0, input.growLines) })),
	};
	const id = await db().begin((tx) => insertScenario(tx, copy));
	return { ok: true, id };
}

/**
 * Write whole scenarios (the proforma import). Refuses when a name exists, unless `replace`,
 * which deletes the scenario of that name first. All or nothing.
 */
export async function writeScenarios(scenarios: BudgetScenarioData[], options: { replace?: boolean } = {}): Promise<Result<{ ids: string[] }>> {
	await dbReady();
	const names = scenarios.map((item) => item.name.trim());
	const existing = await db()`select name from budget_scenarios where lower(name) in ${db()(names.map((name) => name.toLowerCase()))}`;
	if (existing.length && !options.replace) return { ok: false, error: `Already exists: ${existing.map((row) => str(row.name)).join(', ')}. Pass --replace to overwrite.` };
	const ids = await db().begin(async (tx) => {
		if (existing.length) await tx`delete from budget_scenarios where lower(name) in ${tx(names.map((name) => name.toLowerCase()))}`;
		const out: string[] = [];
		for (const scenario of scenarios) out.push(await insertScenario(tx, scenario));
		return out;
	});
	return { ok: true, ids };
}
