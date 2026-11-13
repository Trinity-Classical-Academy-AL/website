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
			} else if (url.pathname === '/Directory') {
				body = '<html><title>Directory</title></html>';
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

const ROLE_PAGE = `<!DOCTYPE html><html><head><title>ChooseRole</title></head><body><div id="RoleSelectContainer"><div class="possibleRole"><form method="post" action="/UserSession/SelectRole"><input type="hidden" name="roleName" value="Admin"><input type="hidden" name="redirectUrl" value="/"><input type="hidden" name="__RequestVerificationToken" value="ADMIN-TOKEN"><button type="submit">Admin</button></form></div><div class="possibleRole"><form method="post" action="/UserSession/SelectRole"><input type="hidden" name="roleName" value="Guardian"><input type="hidden" name="redirectUrl" value="/"><input type="hidden" name="__RequestVerificationToken" value="GUARDIAN-TOKEN"><button type="submit">Guardian</button></form></div></div></body></html>`;

test('a role picker posts the Admin role and login_ok waits for /Admin/School', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'classreach-role-'));
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
			if (method === 'GET' && url.pathname === '/Login') {
				body = LOGIN_PAGE;
				setCookie = '.AspNetCore.Antiforgery.x=anti; path=/; HttpOnly';
			} else if (method === 'POST' && url.pathname === '/Login') {
				status = 302;
				location = '/UserSession/SelectRole';
				setCookie = '.AspNet.SharedCookie=session; path=/; HttpOnly\nset-cookie: currentRole=Admin; path=/';
				body = '';
			} else if (method === 'GET' && url.pathname === '/UserSession/SelectRole') {
				body = ROLE_PAGE;
			} else if (method === 'POST' && url.pathname === '/UserSession/SelectRole') {
				status = 302;
				location = '/Admin/School';
				setCookie = 'currentRole=Admin; path=/';
				body = '';
			} else if (url.pathname === '/') {
				status = 302;
				location = '/Admin/School';
			} else if (url.pathname === '/Admin/School') {
				body = '<html><title>School</title></html>';
			} else if (url.pathname === '/Calendar/events') {
				body = JSON.stringify({ CalendarEvents: [{ CalendarEvent: { CalendarEventID: 9, Title: 'Chapel', StartDate: '2026-11-12' } }] });
			} else if (url.pathname === '/Directory') {
				body = '<html><title>Directory</title></html>';
			} else if (url.pathname === '/Directory/GetDirectoryInfo') {
				body = JSON.stringify({ Directories: [] });
			} else {
				throw new Error(`unexpected ${method} ${url.pathname}`);
			}
			const contentType = url.pathname.startsWith('/Calendar/') || url.pathname.startsWith('/Directory/') ? 'application/json' : 'text/html';
			await writeFile(headerPath, [`HTTP/2 ${status}`, location ? `location: ${location}` : '', setCookie ? `set-cookie: ${setCookie}` : '', `content-type: ${contentType}`, '', ''].filter((line) => line !== '').join('\n'));
			await writeFile(bodyPath, body);
			return { stdout: `${status}\n${url.toString()}\n` };
		},
	});
	try {
		await pullClassReach({
			env: {
				CLASSREACH_USERNAME: 'bryantbrock',
				CLASSREACH_PASSWORD: 'secret-value',
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
	const rolePost = calls.find((call) => call.url.includes('/UserSession/SelectRole') && call.args.includes('POST'));
	assert.equal(rolePost.stdin, 'roleName=Admin&redirectUrl=%2F&__RequestVerificationToken=ADMIN-TOKEN');
	assert.equal(rolePost.stdin.includes('GUARDIAN-TOKEN'), false);
	assert.equal(rolePost.stdin.includes('secret-value'), false);
	assert.match(rolePost.args.join('\n'), /referer: https:\/\/trinityclassicalacademy\.classreach\.com\/UserSession\/SelectRole/);
	assert.match(rolePost.args.join('\n'), /origin: https:\/\/trinityclassicalacademy\.classreach\.com/);
	const directory = calls.find((call) => call.url.includes('/Directory/GetDirectoryInfo'));
	assert.match(directory.args.join('\n'), /x-requested-with: XMLHttpRequest/);
	assert.match(directory.args.join('\n'), /accept: application\/json, text\/javascript, \*\/\*; q=0\.01/);
	assert.match(directory.args.join('\n'), /referer: https:\/\/trinityclassicalacademy\.classreach\.com\/Directory/);
	const logged = lines.map((line) => JSON.parse(line));
	assert.equal(logged.find((line) => line.event === 'login_ok').finalUrl, '/Admin/School');
	assert.equal(logged.find((line) => line.event === 'calendar').events, 1);
});

test('an HTML calendar page is rejected without parsing it as JSON', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'classreach-html-'));
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
			if (method === 'GET' && url.pathname === '/Login') {
				await writeFile(headerPath, 'HTTP/2 200\nset-cookie: .AspNetCore.Antiforgery.x=anti; path=/\n\n');
				await writeFile(bodyPath, LOGIN_PAGE);
				return { stdout: `200\n${url.toString()}\n` };
			}
			if (method === 'POST' && url.pathname === '/Login') {
				await writeFile(headerPath, 'HTTP/2 302\nlocation: /Admin/School\nset-cookie: .AspNet.SharedCookie=session; path=/\nset-cookie: currentRole=Admin; path=/\n\n');
				await writeFile(bodyPath, '');
				return { stdout: `302\n${url.toString()}\n` };
			}
			if (url.pathname === '/Admin/School' || url.pathname === '/') {
				await writeFile(headerPath, 'HTTP/2 200\ncontent-type: text/html\n\n');
				await writeFile(bodyPath, '<html><title>School</title></html>');
				return { stdout: `200\nhttps://trinityclassicalacademy.classreach.com/Admin/School\n` };
			}
			await writeFile(headerPath, 'HTTP/2 200\ncontent-type: text/html\n\n');
			await writeFile(bodyPath, '\r\n<!DOCTYPE html><html><title>Select a role</title><body>picker</body></html>');
			return { stdout: `200\nhttps://trinityclassicalacademy.classreach.com/Calendar/events\n` };
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
			/calendar returned HTML/,
		);
	} finally {
		console.log = original;
		await transport.close();
	}
	const html = lines.map((line) => JSON.parse(line)).find((line) => line.event === 'unexpected_html');
	assert.equal(html.step, 'calendar');
	assert.equal(html.status, 200);
	assert.equal(html.title, 'Select a role');
	assert.equal(JSON.stringify(html).includes('<!DOCTYPE'), false);
	assert.equal(JSON.stringify(html).includes('secret-value'), false);
});

test('a currentRole cookie on ChooseRole is not a successful login', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'classreach-role-cookie-'));
	const lines = [];
	const original = console.log;
	console.log = (value) => lines.push(String(value));
	const transport = await createCurlTransport({
		jarDir: dir,
		execFileImpl: async (args) => {
			const headerPath = args[args.indexOf('-D') + 1];
			const bodyPath = args[args.indexOf('-o') + 1];
			const url = new URL(args[args.length - 1]);
			const method = args.includes('-X') ? args[args.indexOf('-X') + 1] : 'GET';
			if (method === 'GET' && url.pathname === '/Login') {
				await writeFile(headerPath, 'HTTP/2 200\n\n');
				await writeFile(bodyPath, LOGIN_PAGE);
				return { stdout: `200\n${url.toString()}\n` };
			}
			if (method === 'POST' && url.pathname === '/Login') {
				await writeFile(headerPath, 'HTTP/2 302\nlocation: /UserSession/SelectRole\nset-cookie: .AspNet.SharedCookie=session; path=/\nset-cookie: currentRole=Admin; path=/\n\n');
				await writeFile(bodyPath, '');
				return { stdout: `302\n${url.toString()}\n` };
			}
			await writeFile(headerPath, 'HTTP/2 200\ncontent-type: text/html\n\n');
			await writeFile(bodyPath, ROLE_PAGE.replace('name="roleName" value="Admin"', 'name="roleName" value="Guardian"').replace('ADMIN-TOKEN', 'GONE'));
			return { stdout: `200\nhttps://trinityclassicalacademy.classreach.com/UserSession/SelectRole\n` };
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
	const logged = lines.map((line) => JSON.parse(line));
	assert.equal(logged.some((line) => line.event === 'login_ok'), false);
	const failed = logged.find((line) => line.event === 'login_failed');
	assert.equal(failed.finalUrl, '/UserSession/SelectRole');
	assert.deepEqual(failed.roles, ['Guardian']);
	assert.equal(JSON.stringify(failed).includes('secret-value'), false);
});

test('a JSON step that lands on ChooseRole fails as role_not_selected', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'classreach-role-json-'));
	const lines = [];
	const original = console.log;
	console.log = (value) => lines.push(String(value));
	const transport = await createCurlTransport({
		jarDir: dir,
		execFileImpl: async (args) => {
			const headerPath = args[args.indexOf('-D') + 1];
			const bodyPath = args[args.indexOf('-o') + 1];
			const url = new URL(args[args.length - 1]);
			const method = args.includes('-X') ? args[args.indexOf('-X') + 1] : 'GET';
			if (method === 'GET' && url.pathname === '/Login') {
				await writeFile(headerPath, 'HTTP/2 200\n\n');
				await writeFile(bodyPath, LOGIN_PAGE);
				return { stdout: `200\n${url.toString()}\n` };
			}
			if (method === 'POST' && url.pathname === '/Login') {
				await writeFile(headerPath, 'HTTP/2 302\nlocation: /Admin/School\nset-cookie: .AspNet.SharedCookie=session; path=/\n\n');
				await writeFile(bodyPath, '');
				return { stdout: `302\n${url.toString()}\n` };
			}
			if (url.pathname === '/Admin/School') {
				await writeFile(headerPath, 'HTTP/2 200\ncontent-type: text/html\n\n');
				await writeFile(bodyPath, '<html><title>School</title></html>');
				return { stdout: `200\nhttps://trinityclassicalacademy.classreach.com/Admin/School\n` };
			}
			await writeFile(headerPath, 'HTTP/2 200\ncontent-type: text/html\n\n');
			await writeFile(bodyPath, ROLE_PAGE);
			return { stdout: `200\nhttps://trinityclassicalacademy.classreach.com/UserSession/SelectRole\n` };
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
			/role not selected/,
		);
	} finally {
		console.log = original;
		await transport.close();
	}
	const role = lines.map((line) => JSON.parse(line)).find((line) => line.event === 'role_not_selected');
	assert.equal(role.step, 'calendar');
	assert.equal(role.finalUrl, '/UserSession/SelectRole');
	assert.equal(role.title, 'ChooseRole');
	assert.equal(JSON.stringify(role).includes('ADMIN-TOKEN'), false);
});

test('an empty calendar is a warning and the pull continues', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'classreach-empty-cal-'));
	const lines = [];
	const original = console.log;
	console.log = (value) => lines.push(String(value));
	const transport = await createCurlTransport({
		jarDir: dir,
		execFileImpl: async (args) => {
			const headerPath = args[args.indexOf('-D') + 1];
			const bodyPath = args[args.indexOf('-o') + 1];
			const url = new URL(args[args.length - 1]);
			const method = args.includes('-X') ? args[args.indexOf('-X') + 1] : 'GET';
			if (method === 'GET' && url.pathname === '/Login') {
				await writeFile(headerPath, 'HTTP/2 200\n\n');
				await writeFile(bodyPath, LOGIN_PAGE);
				return { stdout: `200\n${url.toString()}\n` };
			}
			if (method === 'POST' && url.pathname === '/Login') {
				await writeFile(headerPath, 'HTTP/2 302\nlocation: /Admin/School\nset-cookie: .AspNet.SharedCookie=session; path=/\n\n');
				await writeFile(bodyPath, '');
				return { stdout: `302\n${url.toString()}\n` };
			}
			if (url.pathname === '/Admin/School') {
				await writeFile(headerPath, 'HTTP/2 200\ncontent-type: text/html\n\n');
				await writeFile(bodyPath, '<html><title>School</title></html>');
				return { stdout: `200\nhttps://trinityclassicalacademy.classreach.com/Admin/School\n` };
			}
			if (url.pathname === '/Calendar/events') {
				await writeFile(headerPath, 'HTTP/2 200\ncontent-type: application/json\n\n');
				await writeFile(bodyPath, JSON.stringify({ CalendarEvents: [] }));
				return { stdout: `200\nhttps://trinityclassicalacademy.classreach.com/Calendar/events\n` };
			}
			await writeFile(headerPath, 'HTTP/2 200\ncontent-type: application/json\n\n');
			await writeFile(bodyPath, JSON.stringify({ Directories: [] }));
			return { stdout: `200\n${url.toString()}\n` };
		},
	});
	try {
		await pullClassReach({
			env: {
				CLASSREACH_USERNAME: 'bryantbrock',
				CLASSREACH_PASSWORD: 'secret-value',
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
	const calendar = lines.map((line) => JSON.parse(line)).find((line) => line.event === 'calendar');
	assert.equal(calendar.level, 'warn');
	assert.equal(calendar.events, 0);
	assert.match(calendar.finalUrl, /^\/Calendar\/events/);
});
