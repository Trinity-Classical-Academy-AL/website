import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
// pullClassReach posts the Admin ChooseRole form before it reads JSON.
import { pullClassReach } from '../../packages/school/src/classreach.ts';

export function execFileCurl(args, stdin) {
	return new Promise((resolve, reject) => {
		const child = execFileCb('curl', args, { encoding: 'buffer', maxBuffer: 20_000_000 }, (error, stdout, stderr) => {
			if (error) {
				error.stderr = stderr?.toString?.() ?? '';
				reject(error);
				return;
			}
			resolve({ stdout: stdout.toString('utf8'), stderr: stderr?.toString?.() ?? '' });
		});
		if (stdin) child.stdin.write(stdin);
		child.stdin.end();
	});
}

export async function createCurlTransport({ execFileImpl = execFileCurl, jarDir, jarPath } = {}) {
	const dir = jarDir || (await mkdtemp(join(tmpdir(), 'classreach-')));
	const jar = jarPath || join(dir, 'cookies.txt');
	await writeFile(jar, '', { mode: 0o600 });
	let sequence = 0;
	return {
		jarPath: jar,
		async close() {
			if (!jarDir) await rm(dir, { recursive: true, force: true });
		},
		fetch: async (url, init) => {
			const id = ++sequence;
			const headerPath = join(dir, `headers-${id}.txt`);
			const bodyPath = join(dir, `body-${id}.bin`);
			const method = (init.method || 'GET').toUpperCase();
			const args = [
				'--silent',
				'--show-error',
				'--compressed',
				'--max-redirs',
				'0',
				'--max-time',
				'15',
				'--cookie',
				jar,
				'--cookie-jar',
				jar,
				'-D',
				headerPath,
				'-o',
				bodyPath,
				'-w',
				'%{http_code}\n%{url_effective}',
			];
			if (method !== 'GET') args.push('-X', method);
			for (const [key, value] of Object.entries(init.headers || {})) {
				if (key.toLowerCase() === 'cookie') continue;
				args.push('-H', `${key}: ${value}`);
			}
			const stdin = init.body ?? '';
			if (stdin && method !== 'GET') args.push('--data-binary', '@-');
			args.push('--', url);
			const { stdout } = await execFileImpl(args, stdin);
			const headerText = (await readFile(headerPath, 'utf8')).replace(/\r\n/g, '\n');
			const body = await readFile(bodyPath);
			const marker = stdout.trim().split('\n');
			const status = Number(marker[0]);
			const effective = marker.slice(1).join('\n');
			const blocks = headerText.split('\n\n').filter((block) => block.trim());
			const last = blocks[blocks.length - 1] || '';
			const setCookies = [];
			const headers = new Map();
			for (const line of last.split('\n').slice(1)) {
				const split = line.indexOf(':');
				if (split <= 0) continue;
				const name = line.slice(0, split).trim().toLowerCase();
				const value = line.slice(split + 1).trim();
				if (name === 'set-cookie') setCookies.push(line.slice(split + 1).trim());
				else headers.set(name, value);
			}
			if (effective) headers.set('x-classreach-url', effective);
			return {
				status,
				headers: {
					get: (name) => headers.get(name.toLowerCase()) ?? null,
					getSetCookie: () => setCookies,
				},
				async text() {
					return body.toString('utf8');
				},
			};
		},
	};
}

export function isDirectRun() {
	const entry = process.argv[1];
	if (!entry) return false;
	return import.meta.url === pathToFileURL(entry).href;
}

function log(event, fields = {}) {
	console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));
}

export async function main() {
	const username = process.env.CLASSREACH_USERNAME ?? '';
	const password = process.env.CLASSREACH_PASSWORD ?? '';
	const token = process.env.CLASSREACH_INGEST_TOKEN ?? '';
	const ingestUrl = process.env.CLASSREACH_INGEST_URL || 'https://portal.trinityclassical.academy/classreach/ingest';
	const sessionPath = process.env.CLASSREACH_SESSION_FILE || join(homedir(), '.local', 'share', 'tca', 'classreach-session.json');
	const transportName = (process.env.CLASSREACH_TRANSPORT || 'curl').toLowerCase();
	if (!username || !password || !token) {
		log('classreach_sync_skipped', { reason: 'credentials-unset' });
		return 0;
	}
	let session = null;
	try {
		session = JSON.parse(await readFile(sessionPath, 'utf8'));
	} catch {
		session = null;
	}
	const curl = transportName === 'curl' ? await createCurlTransport() : null;
	try {
		const pulled = await pullClassReach({
			env: process.env,
			fetch: curl ? curl.fetch : (url, init) => fetch(url, init),
			sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
			session,
			jitterMs: 0,
		});
		await mkdir(dirname(sessionPath), { recursive: true });
		await writeFile(sessionPath, JSON.stringify(pulled.session), { mode: 0o600 });
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
		if (response.status === 429) return 0;
		return response.ok ? 0 : 1;
	} finally {
		await curl?.close();
	}
}

if (isDirectRun()) {
	main()
		.then((code) => process.exit(code))
		.catch((error) => {
			log('classreach_sync_failed', { message: error instanceof Error ? error.message : 'ClassReach pull failed' });
			process.exit(1);
		});
}
