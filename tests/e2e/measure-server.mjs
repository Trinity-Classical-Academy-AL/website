import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';

const base = process.env.PORTAL_E2E_URL || 'http://127.0.0.1:4391';
const seed = JSON.parse(readFileSync('/tmp/tca-e2e-seed.json', 'utf8'));
const routes = [
	['/admin', 'office'], ['/admin/tours', 'office'], ['/admin/families', 'office'],
	['/g', 'ada'], ['/account', 'pat'], ['/home', 'pat'],
	['/admin/prospects', 'office'], ['/admin/staff', 'office'], ['/', ''],
];

function request(route, role) {
	return new Promise((resolve, reject) => {
		const started = performance.now();
		http.get(base + route, { headers: role ? { cookie: `tca_family_session=${seed.cookies[role]}` } : {} }, (response) => {
			const ttfbMs = performance.now() - started;
			const timing = response.headers['server-timing'] || '';
			response.resume();
			response.on('end', () => {
				try {
					assert.equal(response.statusCode, 200, `${route}: verify the seed and session secret`);
					const match = timing.match(/queries;desc="(\d+)"/);
					assert.ok(match, `${route}: Server-Timing is missing`);
					resolve({ ttfbMs, queries: Number(match[1]) });
				} catch (error) { reject(error); }
			});
		}).on('error', reject);
	});
}

const firstRequest = await request('/admin', 'office');
const results = [];
for (const [route, role] of routes) {
	const samples = [];
	for (let i = 0; i < 11; i++) samples.push(await request(route, role));
	const times = samples.map((sample) => sample.ttfbMs).sort((a, b) => a - b);
	results.push({ route, queries: samples[0].queries, medianTtfbMs: +times[5].toFixed(2), p90TtfbMs: +times[9].toFixed(2) });
}
console.log(JSON.stringify({ firstRequest, results }, null, 2));
