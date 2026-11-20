import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Formaloo statuses map onto application statuses as confirmed with the school', () => {
	const source = readFileSync(new URL('../packages/school/src/applications.ts', import.meta.url), 'utf8');
	const map = Object.fromEntries([...source.matchAll(/'([^']+)': '(submitted|reviewing|interview|accepted|waitlisted|declined|withdrawn)'/g)].map((m) => [m[1], m[2]]));
	assert.deepEqual(map, {
		'Proceed with interview': 'interview', 'Pastoral Reference': 'reviewing', 'Interview Held': 'accepted',
		'Not approved for application': 'declined', 'Application sent': 'accepted', 'Family in ClassReach': 'accepted',
	});
});
