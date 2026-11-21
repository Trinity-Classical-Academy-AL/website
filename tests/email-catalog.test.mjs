import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMAILS, fillTemplate } from '../packages/school/src/email-catalog.ts';

test('every catalog email declares exactly the placeholders its copy uses', () => {
	const keys = new Set();
	for (const email of EMAILS) {
		assert.ok(!keys.has(email.key), `duplicate ${email.key}`); keys.add(email.key);
		const used = new Set([...`${email.subject}\n${email.body}`.matchAll(/\{\{\s*([a-z]+)\s*\}\}/gi)].map((m) => m[1]));
		const declared = new Set(email.vars.map((item) => item.name));
		assert.deepEqual([...used].sort(), [...declared].sort(), email.key);
	}
});

test('empty placeholders drop out with their blank line', () => {
	assert.equal(fillTemplate('Hello {{name}},\n\nProposed {{when}}.\n\n{{message}}\n\nOpen the portal.', { name: 'A', when: 'Tue', message: '' }), 'Hello A,\n\nProposed Tue.\n\nOpen the portal.');
	assert.equal(fillTemplate('Hi {{nme}}', {}), 'Hi {{nme}}');
});

test('portal code sends through the catalog, not hand-written emails', async () => {
	const { readFileSync } = await import('node:fs');
	for (const file of ['accounts.ts', 'people.ts', 'portal-admin.ts', 'docs-forms.ts', 'applications.ts', 'reenrollment.ts', 'access.ts', 'tours/requests.ts', 'tours/notifications.ts', 'tours/holds.ts']) {
		const source = readFileSync(new URL(`../packages/school/src/${file}`, import.meta.url), 'utf8');
		assert.doesNotMatch(source, /sendEmail\(\{/, file);
	}
});
