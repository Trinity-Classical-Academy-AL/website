import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('privacy and terms pages are linked from the footer and stay factual', () => {
	const footer = read('src/components/Footer.astro');
	assert.match(footer, /href="\/privacy"/);
	assert.match(footer, /href="\/terms"/);

	const privacy = read('src/pages/privacy.astro');
	const terms = read('src/pages/terms.astro');
	for (const page of [privacy, terms]) {
		assert.match(page, /portal\.trinityclassical\.academy/);
		assert.match(page, /sign in with an email and password, or with Google/i);
		assert.match(page, /info@trinityclassical\.academy/);
		assert.match(page, /7160 Cahaba Valley Rd\./);
		assert.doesNotMatch(page, /phone/i);
		assert.doesNotMatch(page, /\(\d{3}\)/);
		assert.doesNotMatch(page, /Netlify|Neon|PostHog|Resend|Google Cloud|openid/i);
	}
	assert.match(privacy, /trusted service providers for hosting, email, and analytics/);
	assert.match(privacy, /do not sell/i);
	assert.match(privacy, /delete your portal account/);
	assert.match(terms, /href="\/privacy"/);
});
