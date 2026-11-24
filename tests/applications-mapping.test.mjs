import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// One approval, after the interview: "Interview Held" and "Application sent" both mean approved.
// "Family in ClassReach" means the school accepted them and sent the ClassReach sign-up link.
test('Formaloo statuses map onto the family application stages', () => {
	const source = readFileSync(new URL('../packages/school/src/applications.ts', import.meta.url), 'utf8');
	const map = Object.fromEntries([...source.matchAll(/'([^']+)': '(requested|interview|approved|application_submitted|accepted|declined|withdrawn)'/g)].map((m) => [m[1], m[2]]));
	assert.deepEqual(map, {
		'Proceed with interview': 'interview', 'Pastoral Reference': 'interview', 'Interview Held': 'approved',
		'Not approved for application': 'declined', 'Application sent': 'approved', 'Family in ClassReach': 'accepted',
	});
});

test('one application per family is enforced in the database and merges keep every child', () => {
	const schema = readFileSync(new URL('../packages/school/src/schema.ts', import.meta.url), 'utf8');
	assert.match(schema, /create unique index if not exists applications_one_per_family on applications \(family_id\) where family_id is not null/);
	assert.match(schema, /create unique index if not exists applications_one_per_email on applications \(lower\(email\)\) where family_id is null/);
	assert.match(schema, /create or replace function merge_applications/);
	const merge = readFileSync(new URL('../packages/school/src/family-merge.ts', import.meta.url), 'utf8');
	assert.match(merge, /merge_applications/);
});
