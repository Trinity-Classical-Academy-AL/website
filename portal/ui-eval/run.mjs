import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeStatus } from './judges.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const repo = join(root, '../..');
const designDir = join(root, 'design');
const manifest = JSON.parse(readFileSync(join(root, 'reference-manifest.json'), 'utf8'));
const tokens = JSON.parse(readFileSync(join(designDir, 'tokens.json'), 'utf8'));
const browser = process.argv.includes('--browser');

const LIST_SOURCES = [
	'portal/src/pages/admin/tours.astro',
	'portal/src/pages/admin/staff.astro',
	'portal/src/pages/admin/families.astro',
	'portal/src/pages/admin/prospects.astro',
];

function textOf(html) {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&nbsp;/g, ' ')
		.replace(/\s+/g, ' ')
		.toLowerCase();
}

function controls(html) {
	const labels = [...html.matchAll(/<(?:label|legend|button|th)[^>]*>([\s\S]*?)<\/(?:label|legend|button|th)>/gi)]
		.map((match) => match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
		.filter((label) => label && label.length <= 42 && !/\d{4}|@|spots left|full$/.test(label));
	return [...new Set(labels.map((label) => label.toLowerCase()))];
}

function sourceFor(screen) {
	const raw = screen.code_path || '';
	const candidates = raw.split(',').map((part) => part.trim().replace(/^website\//, '').split('?')[0]).filter((part) => part && part !== '(none)');
	const texts = [];
	for (const relative of candidates) {
		const options = [relative, relative.replace(/^components\//, 'portal/src/components/')];
		for (const option of options) {
			const path = join(repo, option);
			if (existsSync(path)) texts.push(readFileSync(path, 'utf8'));
		}
	}
	if (!texts.length && screen.route && !String(screen.route).startsWith('(')) {
		const bits = String(screen.route).split('?')[0].split('/').filter(Boolean).map((bit) => bit.startsWith(':') ? '[id]' : bit);
		const file = join(repo, 'portal/src/pages', ...bits) + '.astro';
		const index = join(repo, 'portal/src/pages', ...bits, 'index.astro');
		if (existsSync(file)) texts.push(readFileSync(file, 'utf8'));
		else if (existsSync(index)) texts.push(readFileSync(index, 'utf8'));
	}
	if (!texts.length && screen.route === '(500)') {
		const errorPage = join(repo, 'portal/src/pages/500.astro');
		if (existsSync(errorPage)) texts.push(readFileSync(errorPage, 'utf8'));
	}
	return texts.join('\n');
}

function designHtml(screen) {
	const views = screen.viewports || [];
	for (const view of views) {
		const file = view.design_html ? basename(view.design_html) : '';
		if (file && existsSync(join(designDir, file))) return { file, html: readFileSync(join(designDir, file), 'utf8') };
	}
	const fallback = existsSync(join(designDir, `${screen.id}.html`)) ? `${screen.id}.html` : `${screen.id}-M.html`;
	const path = join(designDir, fallback);
	return existsSync(path) ? { file: fallback, html: readFileSync(path, 'utf8') } : { file: fallback, html: '' };
}

function fieldScore(design, source) {
	if (!design) return { score: 0, missing: ['design file missing'] };
	const wanted = controls(design).filter((label) => !['open', '×', 'x'].includes(label));
	if (!source) return { score: wanted.length ? 0 : 1, missing: wanted.slice(0, 8), note: 'no source file' };
	const hay = textOf(source);
	const missing = wanted.filter((label) => !hay.includes(label));
	const score = wanted.length ? (wanted.length - missing.length) / wanted.length : 1;
	return { score: Math.round(score * 100) / 100, missing: missing.slice(0, 8), wanted: wanted.length };
}

function outsideSheet(source) {
	const overlayAt = source.search(/slot="overlay"|<ArkDialog/);
	const head = overlayAt === -1 ? source : source.slice(0, overlayAt);
	const forms = [...head.matchAll(/<form\b[^>]*>/gi)].map((match) => match[0]);
	return forms.filter((form) => /method=["']post["']/i.test(form));
}

function antipattern() {
	const failures = [];
	for (const file of LIST_SOURCES) {
		const source = readFileSync(join(repo, file), 'utf8');
		const bad = outsideSheet(source);
		if (bad.length) failures.push({ file, forms: bad });
	}
	return { pass: failures.length === 0, failures };
}

function tokenGate() {
	const css = readFileSync(join(repo, 'portal/public/css/portal.css'), 'utf8');
	const colors = Object.values(tokens.color || tokens.colors || {}).flatMap((value) => typeof value === 'string' ? [value] : Object.values(value || {}));
	const hexes = colors.map((value) => String(value).toLowerCase()).filter((value) => value.startsWith('#'));
	const missing = hexes.filter((hex) => !css.toLowerCase().includes(hex));
	const stray = [];
	for (const file of readdirSync(join(repo, 'portal/src/pages'), { recursive: true })) {
		if (!String(file).endsWith('.astro')) continue;
		const text = readFileSync(join(repo, 'portal/src/pages', file), 'utf8').replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
		for (const match of text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
			if (!hexes.includes(match[0].toLowerCase()) && !stray.find((item) => item.file === file && item.color === match[0])) {
				stray.push({ file: String(file), color: match[0] });
			}
		}
	}
	return { pass: missing.length === 0 && stray.length === 0, missingTokens: missing.slice(0, 12), stray: stray.slice(0, 12) };
}

const screens = [];
for (const screen of manifest.screens || []) {
	const design = designHtml(screen);
	const source = sourceFor(screen);
	const fields = fieldScore(design.html, source);
	const state = design.html ? 1 : 0;
	const score = Math.round(((state + fields.score) / 2) * 100) / 100;
	screens.push({
		id: screen.id,
		route: screen.route,
		state: screen.state,
		design: design.file,
		designPresent: Boolean(design.html),
		sourcePresent: Boolean(source),
		fieldScore: fields.score,
		missingLabels: fields.missing,
		score,
		pass: state === 1 && fields.score >= 0.7,
	});
}

const anti = antipattern();
const token = tokenGate();
const passing = screens.filter((screen) => screen.pass).length;
const report = {
	generated: new Date().toISOString(),
	commit: '00268c47997b087b340f2553fece0951a7915131',
	screens: screens.length,
	passing,
	mean: Math.round((screens.reduce((sum, screen) => sum + screen.score, 0) / screens.length) * 100) / 100,
	gates: {
		state: { pass: screens.every((screen) => screen.designPresent), missing: screens.filter((screen) => !screen.designPresent).map((screen) => screen.id) },
		fields: { pass: screens.every((screen) => screen.fieldScore >= 0.7), below: screens.filter((screen) => screen.fieldScore < 0.7).map((screen) => ({ id: screen.id, score: screen.fieldScore, missing: screen.missingLabels })) },
		antipattern: anti,
		tokens: token,
		browser: browser ? 'requested' : 'skipped (pass --browser with Chrome to screenshot public routes)',
	},
	judges: judgeStatus(root),
	proposals: [
		'Guardian Documents and Forms stay placeholders until Bryant names the data source.',
		'Events admin is not in the v5 export. Do not add it from older frames.',
		'Menu and dialog radius is 6px in v5 (--r-control). Inputs stay 4px.',
	],
	screens,
};

mkdirSync(join(root, 'reports'), { recursive: true });
writeFileSync(join(root, 'reports/latest.json'), JSON.stringify(report, null, 2));
const rows = screens
	.sort((a, b) => a.score - b.score)
	.map((screen) => `<tr class="${screen.pass ? 'ok' : 'bad'}"><td>${screen.id}</td><td>${screen.route || ''}</td><td>${screen.score}</td><td>${screen.fieldScore}</td><td>${(screen.missingLabels || []).join(', ')}</td></tr>`)
	.join('');
writeFileSync(join(root, 'reports/latest.html'), `<!doctype html><meta charset="utf-8"><title>Portal UI gates</title><style>body{font:14px/1.4 system-ui;margin:24px}td,th{border-bottom:1px solid #ddd;padding:4px 8px;text-align:left;vertical-align:top}.bad{background:#fde8e4}</style><h1>Portal UI gates</h1><p>${passing}/${screens.length} screens at or above 0.7. Mean ${report.mean}. Antipattern ${anti.pass ? 'pass' : 'fail'}. Tokens ${token.pass ? 'pass' : 'fail'}.</p><p>Judges: ${report.judges.enabled ? 'on' : report.judges.reason}</p><table><tr><th>Screen</th><th>Route</th><th>Score</th><th>Fields</th><th>Missing labels</th></tr>${rows}</table>`);
console.log(JSON.stringify({ passing, screens: screens.length, mean: report.mean, antipattern: anti.pass, tokens: token.pass, judges: report.judges.enabled, lowest: screens.sort((a, b) => a.score - b.score).slice(0, 8) }, null, 2));
if (!anti.pass || !report.gates.state.pass) process.exitCode = 1;
