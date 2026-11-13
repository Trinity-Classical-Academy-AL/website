import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pullClassReach } from '../../packages/school/src/classreach.ts';

const username = process.env.CLASSREACH_USERNAME ?? '';
const password = process.env.CLASSREACH_PASSWORD ?? '';
const token = process.env.CLASSREACH_INGEST_TOKEN ?? '';
const ingestUrl = process.env.CLASSREACH_INGEST_URL || 'https://portal.trinityclassical.academy/classreach/ingest';
const sessionPath = process.env.CLASSREACH_SESSION_FILE || join(homedir(), '.local', 'share', 'tca', 'classreach-session.json');

function log(event, fields = {}) {
	console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));
}

if (!username || !password || !token) {
	log('classreach_sync_skipped', { reason: 'credentials-unset' });
	process.exit(0);
}

let session = null;
try {
	session = JSON.parse(await readFile(sessionPath, 'utf8'));
} catch {
	session = null;
}

const pulled = await pullClassReach({
	env: process.env,
	fetch: (url, init) => fetch(url, init),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	session,
	jitterMs: 0,
});
await mkdir(dirname(sessionPath), { recursive: true });
await writeFile(sessionPath, JSON.stringify(pulled.session));

const response = await fetch(ingestUrl, {
	method: 'POST',
	headers: {
		authorization: `Bearer ${token}`,
		'content-type': 'application/json',
		accept: 'application/json',
	},
	body: JSON.stringify({
		events: pulled.events,
		people: pulled.people.map((person) => ({ ...person, familyId: null })),
	}),
	signal: AbortSignal.timeout(60_000),
});
const text = await response.text();
log('classreach_ingest_post', { status: response.status, body: text.slice(0, 500) });
if (response.status === 429) process.exit(0);
if (!response.ok) process.exit(1);
