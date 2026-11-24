import type { AstroGlobal } from 'astro';
import { runActions, redirectOnSuccess, toastFrom, type ActionOutcome } from '../actions.ts';
import { csrfToken } from '../security.ts';
import {
	budgetSections, computeBudget, createScenario, deleteBudgetItem, deleteScenario, duplicateScenario, getScenario, listScenarios,
	parseBudgetMoney, parseBudgetRate, saveFee, saveLine, saveStaff, saveStaffSettings, saveTier, scenarioInput, scenarioStatements,
	schoolYearOf, shiftSchoolYear, updateScenario, type BudgetSection, type FieldErrors,
} from '@tca/school';

export const FINANCE_TABS = [
	{ value: 'budget', label: 'Budget' },
	{ value: 'lines', label: 'Line items' },
	{ value: 'staff', label: 'Staffing' },
	{ value: 'compare', label: 'Compare' },
] as const;
export type FinanceTab = (typeof FINANCE_TABS)[number]['value'];

/** The /finance URL for a scenario and tab, plus any extra query (sheets, confirms, toasts). */
export function financeHref(scenarioId: string, tab: FinanceTab, extra: Record<string, string | undefined> = {}): string {
	const params = new URLSearchParams();
	if (scenarioId) params.set('s', scenarioId);
	if (tab !== 'budget') params.set('tab', tab);
	for (const [key, value] of Object.entries(extra)) if (value !== undefined && value !== '') params.set(key, value);
	const query = params.toString();
	return query ? `/finance?${query}` : '/finance';
}

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

/** Parse money and rate fields; a bad one becomes a field error. */
function numbers(form: FormData, money: string[], rates: string[] = [], counts: string[] = []) {
	const fields: FieldErrors = {};
	const values: Record<string, number> = {};
	for (const key of money) {
		const parsed = parseBudgetMoney(text(form, key));
		if (parsed === null) fields[key] = 'Enter an amount like 1,250.00.';
		else values[key] = parsed;
	}
	for (const key of rates) {
		const parsed = parseBudgetRate(text(form, key));
		if (parsed === null) fields[key] = 'Enter a percent like 2 or 1.5.';
		else values[key] = parsed;
	}
	for (const key of counts) {
		const raw = text(form, key);
		if (raw !== '' && !/^\d+$/.test(raw)) fields[key] = 'Enter a whole number.';
		else values[key] = raw === '' ? 0 : Number(raw);
	}
	return { fields, values };
}
// The toast names the problem; enhanced forms keep the typed values but don't mark fields.
const invalid = (fields: FieldErrors): ActionOutcome<never> => ({ error: Object.values(fields).join(' '), fields });

/** Load the scenario, run the page's actions, then derive what each tab renders. */
export async function loadFinanceBudget(Astro: AstroGlobal) {
	const q = Astro.url.searchParams;
	const csrf = csrfToken(Astro.cookies, Astro.url.protocol === 'https:');
	const tab: FinanceTab = FINANCE_TABS.find((item) => item.value === q.get('tab'))?.value ?? 'budget';
	const scenarios = await listScenarios();
	const thisYear = schoolYearOf();
	const scenarioId = scenarios.find((item) => item.id === q.get('s'))?.id
		?? scenarios.find((item) => item.primary && item.schoolYear === thisYear)?.id
		?? scenarios.find((item) => item.primary && item.schoolYear > thisYear)?.id
		?? scenarios.find((item) => item.primary)?.id
		?? scenarios[0]?.id ?? '';
	// Links carry ?s= only when the URL chose the scenario, so /finance and its sheets match the default one.
	const linkId = q.get('s') === scenarioId ? scenarioId : '';
	const here = (extra: Record<string, string | undefined> = {}, onTab: FinanceTab = tab) => financeHref(linkId, onTab, extra);
	const saved = (onTab: FinanceTab = tab) => here({ saved: '1' }, onTab);

	const result = await runActions(Astro, {
		'create-scenario': async (form) => {
			const created = await createScenario({ name: text(form, 'name'), schoolYear: text(form, 'schoolYear'), notes: text(form, 'notes') });
			return redirectOnSuccess(created, (value) => financeHref(value.id, 'lines', { created: '1' }));
		},
		'update-scenario': async (form) => {
			const { fields, values } = numbers(form, ['donation']);
			if (Object.keys(fields).length) return invalid(fields);
			const outcome = await updateScenario({ id: scenarioId, name: text(form, 'name'), schoolYear: text(form, 'schoolYear'), notes: text(form, 'notes'), churchDonationCents: values.donation, primary: form.get('primary') === 'on' });
			return redirectOnSuccess(outcome, saved());
		},
		'delete-scenario': async () => redirectOnSuccess(await deleteScenario(scenarioId), '/finance?removed=1'),
		'duplicate-scenario': async (form) => {
			const { fields, values } = numbers(form, [], ['growth']);
			if (Object.keys(fields).length) return invalid(fields);
			const copy = await duplicateScenario({ id: scenarioId, name: text(form, 'name'), schoolYear: text(form, 'schoolYear'), growthBps: values.growth, growLines: form.get('growLines') === 'on', growStaff: form.get('growStaff') === 'on', growTuition: form.get('growTuition') === 'on' });
			return redirectOnSuccess(copy, (value) => financeHref(value.id, 'budget', { copied: '1' }));
		},
		'staff-settings': async (form) => {
			const { fields, values } = numbers(form, ['medical', 'retirement'], ['subRate', 'payrollTax']);
			if (Object.keys(fields).length) return invalid(fields);
			return redirectOnSuccess(await saveStaffSettings({ id: scenarioId, subRateBps: values.subRate, payrollTaxBps: values.payrollTax, medicalCents: values.medical, retirementCents: values.retirement }), saved('staff'));
		},
		'save-tier': async (form) => {
			const { fields, values } = numbers(form, ['tuition'], [], ['students']);
			if (Object.keys(fields).length) return invalid(fields);
			return redirectOnSuccess(await saveTier({ scenarioId, id: text(form, 'id') || undefined, label: text(form, 'label'), tuitionCents: values.tuition, students: values.students }), saved('lines'));
		},
		'save-fee': async (form) => {
			const { fields, values } = numbers(form, ['amount'], [], ['students']);
			if (Object.keys(fields).length) return invalid(fields);
			const everyone = text(form, 'students') === '';
			return redirectOnSuccess(await saveFee({ scenarioId, id: text(form, 'id') || undefined, label: text(form, 'label'), amountCents: values.amount, students: everyone ? null : values.students }), saved('lines'));
		},
		'save-staff': async (form) => {
			const { fields, values } = numbers(form, ['pay']);
			if (Object.keys(fields).length) return invalid(fields);
			return redirectOnSuccess(await saveStaff({ scenarioId, id: text(form, 'id') || undefined, name: text(form, 'name'), group: text(form, 'group'), role: text(form, 'role'), payCents: values.pay, onPayroll: form.get('onPayroll') === 'on' }), saved('staff'));
		},
		'save-line': async (form) => {
			const { fields, values } = numbers(form, ['amount'], ['rate'], ['count']);
			if (Object.keys(fields).length) return invalid(fields);
			return redirectOnSuccess(await saveLine({
				scenarioId, id: text(form, 'id') || undefined, section: text(form, 'section'), kind: text(form, 'kind') || null, label: text(form, 'label'),
				rule: text(form, 'rule'), amountCents: values.amount, rateBps: values.rate, count: values.count, tierId: text(form, 'tierId') || null, note: text(form, 'note'),
			}), saved('lines'));
		},
		'delete-item': async (form) => {
			const kind = text(form, 'kind');
			if (kind !== 'tier' && kind !== 'fee' && kind !== 'staff' && kind !== 'line') return { error: 'Nothing to delete.' };
			return redirectOnSuccess(await deleteBudgetItem(kind, scenarioId, text(form, 'id')), here({ deleted: '1' }, kind === 'staff' ? 'staff' : 'lines'));
		},
	});
	if ('redirect' in result) return Astro.redirect(result.redirect, result.status ?? 303);

	const scenario = scenarioId ? await getScenario(scenarioId) : null;
	const statement = scenario ? computeBudget(scenarioInput(scenario)) : null;
	const compare = tab === 'compare' ? await scenarioStatements() : [];

	// Open sheets come from the URL: ?sheet=new|edit|duplicate|settings, or ?line=, ?tier=, ?fee=, ?staff= (an id or "new").
	const sheet = q.get('sheet') ?? '';
	const pick = <T extends { id: string }>(key: string, rows: T[]) => {
		const value = q.get(key);
		if (!value) return null;
		return value === 'new' ? 'new' as const : rows.find((row) => row.id === value) ?? null;
	};
	const line = scenario && tab === 'lines' ? pick('line', scenario.lines) : null;
	const tier = scenario && tab === 'lines' ? pick('tier', scenario.tiers) : null;
	const fee = scenario && tab === 'lines' ? pick('fee', scenario.fees) : null;
	const person = scenario && tab === 'staff' ? pick('staff', scenario.staff) : null;
	const newSection = (budgetSections as readonly string[]).includes(q.get('section') ?? '') ? q.get('section') as BudgetSection : 'fixed';
	const confirming = q.get('confirm') === '1';

	const toast = toastFrom(Astro.url, {
		saved: 'Saved.',
		created: 'Budget created. Add its tiers, fees and lines.',
		copied: 'Copied. This is the new budget.',
		deleted: 'Removed.',
		removed: 'Budget deleted.',
	});
	const nextYear = scenario ? shiftSchoolYear(scenario.schoolYear, 1) : shiftSchoolYear(thisYear, 1);
	return {
		csrf, tab, scenarios, scenarioId, scenario, statement, compare, here, thisYear, nextYear,
		sheet, line, tier, fee, person, newSection, confirming, toast,
		error: result.error, fields: result.fields,
	};
}

export type FinanceBudgetView = Exclude<Awaited<ReturnType<typeof loadFinanceBudget>>, Response>;
