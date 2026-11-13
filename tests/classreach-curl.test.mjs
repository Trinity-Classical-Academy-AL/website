import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
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
	assert.equal(args.includes('--location'), true);
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
