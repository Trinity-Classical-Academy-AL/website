// Local-only adapter preview: serves the actual Netlify build without Netlify CLI/deploys.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { Readable } from 'node:stream';
import { createHandler } from '../../portal/.netlify/build/entry.mjs';

const root = resolve('portal/dist');
const handler = createHandler({});
const types = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
	try {
		const url = new URL(req.url, `http://${req.headers.host}`);
		const file = resolve(root, '.' + decodeURIComponent(url.pathname));
		if (file.startsWith(root + '/') && await stat(file).then((s) => s.isFile(), () => false)) {
			res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
			res.end(await readFile(file));
			return;
		}
		const request = new Request(url, {
			method: req.method, headers: req.headers,
			...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: Readable.toWeb(req), duplex: 'half' } : {}),
		});
		const response = await handler(request, { ip: '127.0.0.1' });
		res.writeHead(response.status, {
			...Object.fromEntries(response.headers),
			...(response.headers.getSetCookie().length ? { 'set-cookie': response.headers.getSetCookie() } : {}),
		});
		res.end(Buffer.from(await response.arrayBuffer()));
	} catch (error) {
		console.error(error.message);
		res.writeHead(500).end('Preview error');
	}
});
server.listen(Number(process.env.PORT || 4391), '127.0.0.1', () => console.log(`Local build preview PID ${process.pid}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => process.kill(process.pid, 'SIGTERM'));
