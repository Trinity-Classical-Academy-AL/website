import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseLoginToken, pullClassReach } from '../packages/school/src/classreach.ts';
import { createCurlTransport } from '../portal/scripts/classreach-pull.mjs';

test('curl transport posts the body on stdin and keeps the password out of argv', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'classreach-test-'));
	const calls = [];
	const transport = await createCurlTransport({
		jarDir: dir,
		execFileImpl: async (args, stdin) => {
			calls.push({ args, stdin });
			const headerPath = args[args.indexOf('-D') + 1];
			const bodyPath = args[args.indexOf('-o') + 1];
			await writeFile(headerPath, 'HTTP/2 200\ncontent-type: text/html\nset-cookie: .AspNet.SharedCookie=abc; HttpOnly\ncf-ray: ray-9\n\n');
			await writeFile(bodyPath, '<form>ok</form>');
			return { stdout: '200\nhttps://trinityclassicalacademy.classreach.com/Admin/School\n' };
		},
	});
	const password = 'secret-value';
	const response = await transport.fetch('https://trinityclassicalacademy.classreach.com/Login?returnUrl=%2F', {
		method: 'POST',
		headers: {
			'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
			accept: 'text/html',
			'accept-language': 'en-US,en;q=0.9',
			origin: 'https://trinityclassicalacademy.classreach.com',
			referer: 'https://trinityclassicalacademy.classreach.com/Login?ReturnUrl=%2F',
			'content-type': 'application/x-www-form-urlencoded',
			cookie: '.AspNet.SharedCookie=old',
		},
		body: `Username=bryantbrock&Password=${password}&__RequestVerificationToken=token-abc`,
		redirect: 'manual',
	});
	const args = calls[0].args;
	assert.equal(args.includes('--compressed'), true);
	assert.equal(args.includes('--location'), false);
	assert.equal(args[args.indexOf('--max-redirs') + 1], '0');
	assert.equal(args[args.indexOf('--cookie') + 1], args[args.indexOf('--cookie-jar') + 1]);
	assert.equal(args.includes('--data-binary'), true);
	assert.equal(args.includes('@-'), true);
	assert.equal(args.includes('--cookie-jar'), true);
	assert.equal(args.some((arg) => String(arg).includes(password)), false);
	assert.match(calls[0].stdin, new RegExp(`Password=${password}`));
	assert.equal(args.includes('.AspNet.SharedCookie=old'), false);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('x-classreach-url'), 'https://trinityclassicalacademy.classreach.com/Admin/School');
	assert.deepEqual(response.headers.getSetCookie(), ['.AspNet.SharedCookie=abc; HttpOnly']);
	const mode = (await stat(transport.jarPath)).mode & 0o777;
	assert.equal(mode, 0o600);
	const jar = await readFile(transport.jarPath, 'utf8');
	assert.equal(jar, '');
	await transport.close();
});

const LOGIN_PAGE = `<form action="/Login" method="post"><input type="hidden" value="TOKEN-FIRST" name="__RequestVerificationToken"><input name="Username"><input name="Password"></form><form id="fileUploadForm"><input name="__RequestVerificationToken" type="hidden" value="TOKEN-SECOND"></form>`;

test('the first login token is used, and a redirect chain counts as success', async () => {
	assert.equal(parseLoginToken(LOGIN_PAGE), 'TOKEN-FIRST');
	const dir = await mkdtemp(join(tmpdir(), 'classreach-replay-'));
	const calls = [];
	const lines = [];
	const original = console.log;
	console.log = (value) => {
		lines.push(String(value));
		original(value);
	};
	const transport = await createCurlTransport({
		jarDir: dir,
		execFileImpl: async (args, stdin) => {
			calls.push({ url: args[args.length - 1], args, stdin });
			const headerPath = args[args.indexOf('-D') + 1];
			const bodyPath = args[args.indexOf('-o') + 1];
			const url = new URL(args[args.length - 1]);
			const method = args.includes('-X') ? args[args.indexOf('-X') + 1] : 'GET';
			let status = 200;
			let location = '';
			let setCookie = '';
			let body = 'ok';
			let effective = url.toString();
			if (method === 'GET' && url.pathname === '/Login') {
				body = LOGIN_PAGE;
				setCookie = '.AspNetCore.Antiforgery.x=anti; path=/; HttpOnly';
			} else if (method === 'POST' && url.pathname === '/Login') {
				status = 302;
				location = '/UserSession/SelectRole';
				setCookie = '.AspNet.SharedCookie=session; path=/; HttpOnly';
				body = '';
			} else if (url.pathname === '/UserSession/SelectRole') {
				status = 302;
				location = '/';
			} else if (url.pathname === '/') {
				status = 302;
				location = '/Admin/School';
			} else if (url.pathname === '/Admin/School') {
				body = 'school';
				effective = url.toString();
			} else if (url.pathname === '/Calendar/events') {
				body = JSON.stringify({ CalendarEvents: [] });
			} else if (url.pathname === '/Directory/GetDirectoryInfo') {
				body = JSON.stringify({ Directories: [] });
			} else {
				throw new Error(`unexpected ${method} ${url.pathname}`);
			}
			const header = [`HTTP/2 ${status}`, location ? `location: ${location}` : '', setCookie ? `set-cookie: ${setCookie}` : '', '', ''].filter((line) => line !== '').join('\n');
			await writeFile(headerPath, header);
			await writeFile(bodyPath, body);
			return { stdout: `${status}\n${effective}\n` };
		},
	});
	try {
		await pullClassReach({
			env: {
				CLASSREACH_USERNAME: 'bryantbrock',
				CLASSREACH_PASSWORD: 'a&b=c',
				CLASSREACH_BASE_URL: 'https://trinityclassicalacademy.classreach.com',
			},
			fetch: transport.fetch,
			sleep: async () => {},
			jitterMs: 0,
			now: new Date('2026-11-11T18:00:00Z'),
		});
	} finally {
		console.log = original;
		await transport.close();
	}
	const post = calls.find((call) => call.args.includes('-X') && call.args[call.args.indexOf('-X') + 1] === 'POST');
	assert.match(post.stdin, /__RequestVerificationToken=TOKEN-FIRST/);
	assert.doesNotMatch(post.stdin, /TOKEN-SECOND/);
	assert.match(post.stdin, /Password=a%26b%3Dc/);
	assert.equal(post.args.some((arg) => String(arg).includes('a&b=c')), false);
	assert.match(post.args.join('\n'), /referer: https:\/\/trinityclassicalacademy\.classreach\.com\/Login/);
	const jar = post.args[post.args.indexOf('--cookie') + 1];
	assert.equal(jar, post.args[post.args.indexOf('--cookie-jar') + 1]);
	assert.equal(calls[0].args[calls[0].args.indexOf('--cookie') + 1], jar);
	assert.match(lines.join('\n'), /"event":"login_ok"/);
});

test('a login page that stays on /Login logs the final URL and validation text', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'classreach-fail-'));
	const lines = [];
	const original = console.log;
	console.log = (value) => {
		lines.push(String(value));
	};
	const transport = await createCurlTransport({
		jarDir: dir,
		execFileImpl: async (args) => {
			const headerPath = args[args.indexOf('-D') + 1];
			const bodyPath = args[args.indexOf('-o') + 1];
			const url = new URL(args[args.length - 1]);
			const method = args.includes('-X') ? args[args.indexOf('-X') + 1] : 'GET';
			if (method === 'GET') {
				await writeFile(headerPath, 'HTTP/2 200\nset-cookie: .AspNetCore.Antiforgery.x=anti; path=/\n\n');
				await writeFile(bodyPath, LOGIN_PAGE);
				return { stdout: `200\n${url.toString()}\n` };
			}
			await writeFile(headerPath, 'HTTP/2 200\n\n');
			await writeFile(bodyPath, '<div class="validation-summary-errors"><span>The user name or password is incorrect.</span></div>');
			return { stdout: `200\n${url.toString()}\n` };
		},
	});
	try {
		await assert.rejects(
			pullClassReach({
				env: {
					CLASSREACH_USERNAME: 'bryantbrock',
					CLASSREACH_PASSWORD: 'secret-value',
					CLASSREACH_BASE_URL: 'https://trinityclassicalacademy.classreach.com',
				},
				fetch: transport.fetch,
				sleep: async () => {},
				jitterMs: 0,
				now: new Date('2026-11-11T18:00:00Z'),
			}),
			/ClassReach login failed/,
		);
	} finally {
		console.log = original;
		await transport.close();
	}
	const failed = lines.map((line) => JSON.parse(line)).find((line) => line.event === 'login_failed');
	assert.equal(failed.status, 200);
	assert.match(failed.finalUrl, /^\/Login/);
	assert.equal(failed.sharedCookie, false);
	assert.match(failed.validation, /user name or password is incorrect/);
	assert.equal(JSON.stringify(failed).includes('secret-value'), false);
});
