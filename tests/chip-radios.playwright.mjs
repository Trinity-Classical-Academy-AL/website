import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const css = readFileSync(new URL('../portal/public/css/portal.css', import.meta.url), 'utf8');
const groups = [
	{ name: 'type', kind: 'chip', options: ['Campus tour', 'Open house', 'Info night'] },
	{ name: 'clickAction', kind: 'chip', options: ['Open the flyer popup', 'Go to a link'] },
	{ name: 'mode', kind: 'chip', options: ['Confirmed visit', 'Proposed time (family accepts)'] },
	{ name: 'audience', kind: 'chip', options: ['Everyone', 'A grade', 'A family'] },
	{ name: 'yesno', kind: 'chip', options: ['Yes', 'No'] },
	{ name: 'slotId', kind: 'optc', options: ['Wednesday morning', 'Saturday open house'] },
];

function markup() {
	return groups.map((group) => {
		const options = group.options.map((label, index) => {
			const stale = index === 0 ? ' on' : '';
			return `<label class="${group.kind}${stale}"><input type="radio" name="${group.name}" value="${index}" ${index === 0 ? 'checked' : ''}>${label}</label>`;
		}).join('');
		const wrap = group.kind === 'optc' ? 'opts' : 'chips';
		return `<fieldset data-group="${group.name}"><div class="${wrap}">${options}</div></fieldset>`;
	}).join('');
}

function highlighted(color) {
	return color.replace(/\s/g, '') !== 'rgb(255,255,255)' && color !== 'rgba(0,0,0,0)';
}

const executablePath = process.env.CHROME_PATH || (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent(`<!doctype html><style>${css}</style><div class="root">${markup()}</div>`);

for (const group of groups) {
	const labels = page.locator(`[data-group="${group.name}"] label`);
	const count = await labels.count();
	for (let index = 0; index < count; index += 1) {
		await labels.nth(index).locator('input').click();
		const states = [];
		for (let other = 0; other < count; other += 1) {
			const background = await labels.nth(other).evaluate((element) => getComputedStyle(element).backgroundColor);
			states.push(highlighted(background));
		}
		assert.deepEqual(states, states.map((_, item) => item === index), `${group.name}: only option ${index} should be highlighted, got ${states.join(',')}`);
	}
	const input = labels.nth(1).locator('input');
	await input.focus();
	const inputOutline = await input.evaluate((element) => getComputedStyle(element).outlineStyle);
	const chipOutline = await labels.nth(1).evaluate((element) => getComputedStyle(element).outlineColor);
	assert.equal(inputOutline, 'none', `${group.name}: the radio itself should not draw a native focus ring`);
	assert.equal(chipOutline.replace(/\s/g, ''), 'rgb(39,109,51)', `${group.name}: focus should use the forest ring`);
}

await browser.close();
console.log('radio groups keep a single highlight');
