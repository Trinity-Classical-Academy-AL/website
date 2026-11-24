import { test } from 'node:test';
import assert from 'node:assert/strict';

const DAY = 86400000;
const now = Date.parse('2026-11-24T18:00:00Z');
const at = (days) => new Date(now - days * DAY).toISOString();
const row = (over = {}) => ({ key: 'k', account: null, name: 'Daniel Parker', emails: ['dp@example.com'], phone: '', stage: 'inquired', children: [], tour: '', inquiries: [], applications: [], updates: [], firstAt: at(30), lastAt: at(1), followUp: '', contactedAt: null, contactedBy: null, priorYear: false, alreadyFamily: false, ...over });
const inquiry = (over = {}) => ({ id: 'i1', contactType: 'inquiry', status: 'new', message: 'Tell us about next steps.', createdAt: at(1), contactedAt: null, ...over });
const app = (status, over = {}) => ({ id: 'a1', status, children: [{ name: 'Evelyn' }], updatedAt: at(1), fullApplication: null, ...over });

test('next step: one clear action per situation', async () => {
	const { nextStep } = await import('../portal/src/lib/next-step.ts');
	const step = (r, interview = null) => nextStep(r, interview, now, '2026-11-24');

	const reply = step(row({ inquiries: [inquiry()] }));
	assert.equal(reply.key, 'reply');
	assert.equal(reply.inquiryId, 'i1');
	assert.match(reply.primary.href, /^mailto:dp%40example\.com\?subject=/);
	assert.equal(reply.secondary.action, 'contacted');

	assert.equal(step(row({ inquiries: [inquiry({ contactType: 'teaching' })] })).key, 'hiring', 'teaching inquiries go to Hiring first');
	assert.equal(step(row({ stage: 'applied', applications: [app('requested')], inquiries: [inquiry()] })).key, 'invite', 'the application outranks a loose inquiry');
	assert.equal(step(row({ stage: 'applied', applications: [app('interview')] })).key, 'waiting');
	assert.equal(step(row({ stage: 'applied', applications: [app('interview')] }), { date: '2026-12-03', when: 'Dec 3' }).title, 'Interview Dec 3');
	const decide = step(row({ stage: 'applied', applications: [app('interview')] }), { date: '2026-11-20', when: 'Nov 20' });
	assert.equal(decide.key, 'decide');
	assert.deepEqual([decide.primary.fields.status, decide.secondary.fields.status], ['approved', 'declined']);
	assert.equal(step(row({ stage: 'applied', applications: [app('application_submitted')] })).key, 'review');
	assert.equal(step(row({ stage: 'applied', applications: [app('accepted')] })).key, 'resend');
	assert.equal(step(row({ stage: 'applied', applications: [app('declined')] })).key, 'none', 'closed applications ask nothing');
	assert.equal(step(row({ stage: 'account', tour: 'Time requested' })).key, 'propose');
	assert.equal(step(row({ stage: 'tour', tour: 'Booked Thu, Dec 3 · 9:00 AM' })).title, 'Tour booked: Thu, Dec 3 · 9:00 AM');
	assert.equal(step(row({ inquiries: [inquiry({ status: 'contacted', contactedAt: at(20) })], lastAt: at(20) })).key, 'followup');
	assert.equal(step(row({ inquiries: [inquiry({ status: 'contacted', contactedAt: at(3) })], lastAt: at(3) })).key, 'none', 'recently contacted: wait');
	assert.equal(step(row({ stage: 'updates' })).title, 'On the updates list');
	assert.equal(step(row({ stage: 'enrolled', inquiries: [inquiry()] })).key, 'none');
});
