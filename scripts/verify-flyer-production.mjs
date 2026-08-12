import assert from 'node:assert/strict';

const baseUrl = process.argv[2] || 'https://trinityclassical.academy';
const expectedCommit = process.argv[3];
const cacheBust = Date.now();
const homepage = await fetch(`${baseUrl}/?qa=${cacheBust}`, {
	headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'BrockSoftware-SDLC-Verify/1.0' },
});
assert.equal(homepage.status, 200);
const html = await homepage.text();
assert.doesNotMatch(html, /data-flyer-announcement|tca-orientation-august-6-2026|Thursday, August 6, 2026/i);
if (expectedCommit) {
	assert.match(html, new RegExp(`<meta name="build-commit" content="${expectedCommit}"`));
}

const flyer = await fetch(
	`${baseUrl}/events/tca-orientation-august-6-2026.jpeg?qa=${cacheBust}`,
	{ headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'BrockSoftware-SDLC-Verify/1.0' } },
);
assert.equal(flyer.status, 404);

console.log(`PASS: ${baseUrl}/ returns 200 without orientation flyer markup`);
console.log('PASS: expired orientation flyer asset returns 404');
if (expectedCommit) console.log(`PASS: production build fingerprint matches ${expectedCommit}`);
