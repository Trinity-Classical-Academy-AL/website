// Serve the Netlify production build locally, without a watcher or network deploy.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const base = new URL(process.env.PORTAL_E2E_URL || 'http://127.0.0.1:4391');
if (base.hostname !== '127.0.0.1' || !/^439[0-9]$/.test(base.port)) throw new Error('Use a local port from 4390 to 4399');
// Local verification must never deliver email or school webhooks.
process.env.RESEND_API_KEY = '';
process.env.SCHOOL_NOTIFY_WEBHOOK_URL = '';
const { createHandler } = await import(pathToFileURL(path.join(root, 'portal/.netlify/build/entry.mjs')));
const handler = createHandler({});
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = http.createServer(async (request, response) => {
	try {
		const url = new URL(request.url, base);
		if (/^\/(?:_astro|assets|css)\//.test(url.pathname) || /^\/favicon/.test(url.pathname)) {
			const file = path.join(root, 'portal/dist', url.pathname);
			const bytes = await readFile(file);
			response.setHeader('content-type', mime[path.extname(file)] || 'application/octet-stream');
			response.end(request.method === 'HEAD' ? undefined : bytes);
			return;
		}
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		const body = Buffer.concat(chunks);
		const result = await handler(new Request(url, {
			method: request.method, headers: request.headers,
			...(body.length ? { body, duplex: 'half' } : {}),
		}), { ip: '127.0.0.1' });
		response.statusCode = result.status;
		for (const [key, value] of result.headers) if (key !== 'set-cookie') response.setHeader(key, value);
		const cookies = result.headers.getSetCookie();
		if (cookies.length) response.setHeader('set-cookie', cookies);
		response.flushHeaders();
		for await (const chunk of result.body || []) response.write(chunk);
		response.end();
	} catch {
		response.statusCode = 500;
		response.end('Local build harness error');
	}
});
server.listen(Number(base.port), base.hostname, () => console.log(`Local portal build: ${base.origin}; PID ${process.pid}`));

// A terminal controller can send "kill <PID>"; signals also shut down the server.
process.stdin.on('data', (line) => {
	if (line.toString().trim() === `kill ${process.pid}`) process.kill(process.pid, 'SIGTERM');
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
	server.close(() => process.exit(0));
	server.closeAllConnections();
});
