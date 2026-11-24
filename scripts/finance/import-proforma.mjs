#!/usr/bin/env node
// Write the proforma budgets into the database, once.
//
//   node scripts/finance/import-proforma.mjs <proforma.json> [--replace]
//
// The JSON comes from scripts/finance/proforma-to-json.py and holds named salaries, so it
// lives outside the repo. Refuses when a scenario of the same name exists, unless --replace.
// Prints each scenario's computed totals so they can be checked against the sheet.
import { readFile } from 'node:fs/promises';
import { computeBudget, db, formatBudgetMoney, getScenario, scenarioInput, writeScenarios } from '@tca/school';

const args = process.argv.slice(2);
const replace = args.includes('--replace');
const path = args.find((arg) => !arg.startsWith('--'));
if (!path) {
	console.error('usage: node scripts/finance/import-proforma.mjs <proforma.json> [--replace]');
	process.exit(2);
}
if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL is not set.');
	process.exit(2);
}

const { scenarios } = JSON.parse(await readFile(path, 'utf8'));
if (!Array.isArray(scenarios) || !scenarios.length) {
	console.error(`${path} has no scenarios.`);
	process.exit(1);
}

try {
	const result = await writeScenarios(scenarios, { replace });
	if (!result.ok) {
		console.error(result.error);
		process.exitCode = 1;
	} else {
		for (const id of result.ids) {
			const scenario = await getScenario(id);
			const s = computeBudget(scenarioInput(scenario));
			console.log(`${scenario.name} (${scenario.schoolYear})${scenario.primary ? ' — primary' : ''}`);
			const rows = [
				['Census', String(s.census)], ['Faculty counted', String(s.facultyCount)],
				['Gross revenue', s.revenue.gross.amount], ['Discounts', s.discounts.total.amount], ['Net revenue', s.netRevenue.amount],
				['Personnel', s.personnel.total.amount], ['Fixed', s.fixed.total.amount], ['Variable', s.variable.total.amount],
				['Total expenses', s.totalExpenses.amount], ['Net income', s.net.amount], ['Church donation', s.churchDonation.amount], ['Final budget', s.final.amount],
			];
			for (const [label, value] of rows) console.log(`  ${label.padEnd(16)} ${typeof value === 'number' ? formatBudgetMoney(value) : value}`);
		}
	}
} finally {
	await db().end();
}
