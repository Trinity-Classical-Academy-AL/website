import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
	cpSync,
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dependencyPath = join(repo, 'node_modules');
const playwrightModule =
	process.env.PLAYWRIGHT_MODULE_PATH ||
	'/Users/bryantbrock/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const mediaDir = process.env.FLYER_QA_MEDIA_DIR
	? resolve(process.env.FLYER_QA_MEDIA_DIR)
	: null;

if (!existsSync(dependencyPath)) {
	throw new Error('node_modules is required to build the temporary Astro QA fixture.');
}

const fixture = mkdtempSync(join(tmpdir(), 'tca-flyer-runtime-'));
const ignored = new Set(['.git', '.astro', 'dist', 'node_modules']);
cpSync(repo, fixture, {
	recursive: true,
	filter(source) {
		const firstPart = relative(repo, source).split('/')[0];
		return !ignored.has(firstPart);
	},
});
symlinkSync(dependencyPath, join(fixture, 'node_modules'), 'dir');

const expiringPage = `---
import OrientationAnnouncement from '../components/OrientationAnnouncement.astro';
import Layout from '../layouts/Layout.astro';
---
<Layout title="Flyer expiration QA" description="Temporary component QA route" noindex>
  <OrientationAnnouncement
    eyebrow="Upcoming school event"
    details="Thursday, August 6, 2099 · 6:30 PM"
    flyerSrc="/og-image.png"
    flyerAlt="Trinity Classical Academy event flyer QA fixture"
    storageKey="tca_flyer_qa_expiring"
    autoOpenPath="/flyer-qa/"
    expirationDate="2099-08-06"
  />
  <main class="mx-auto max-w-canvas px-6 py-16"><h1 class="font-display text-5xl">Expiring flyer fixture</h1></main>
</Layout>
`;
const persistentPage = `---
import OrientationAnnouncement from '../components/OrientationAnnouncement.astro';
import Layout from '../layouts/Layout.astro';
---
<Layout title="Persistent flyer QA" description="Temporary component QA route" noindex>
  <OrientationAnnouncement
    eyebrow="School announcement"
    details="No expiration configured"
    flyerSrc="/og-image.png"
    flyerAlt="Trinity Classical Academy persistent flyer QA fixture"
    storageKey="tca_flyer_qa_persistent"
    autoOpenPath={null}
  />
  <main class="mx-auto max-w-canvas px-6 py-16"><h1 class="font-display text-5xl">Persistent flyer fixture</h1></main>
</Layout>
`;
writeFileSync(join(fixture, 'src/pages/flyer-qa.astro'), expiringPage);
writeFileSync(join(fixture, 'src/pages/flyer-qa-no-expiration.astro'), persistentPage);

const build = spawnSync(join(fixture, 'node_modules/.bin/astro'), ['build'], {
	cwd: fixture,
	env: {
		...process.env,
		PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
	},
	encoding: 'utf8',
});
process.stdout.write(build.stdout);
process.stderr.write(build.stderr);
assert.equal(build.status, 0, 'temporary Astro flyer fixture should build');

const contentTypes = {
	'.css': 'text/css',
	'.html': 'text/html',
	'.jpg': 'image/jpeg',
	'.js': 'text/javascript',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.webp': 'image/webp',
	'.woff2': 'font/woff2',
};
const server = createServer((request, response) => {
	const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
	let filePath = join(fixture, 'dist', pathname);
	if (pathname.endsWith('/')) filePath = join(filePath, 'index.html');
	try {
		const body = readFileSync(filePath);
		response.writeHead(200, { 'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream' });
		response.end(body);
	} catch {
		response.writeHead(404);
		response.end('Not found');
	}
});
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const address = server.address();
assert.equal(typeof address, 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

const { chromium } = await import(playwrightModule);
const browser = await chromium.launch();
if (mediaDir) mkdirSync(mediaDir, { recursive: true });

try {
	const context = await browser.newContext({
		viewport: { width: 390, height: 844 },
		timezoneId: 'Pacific/Kiritimati',
		recordVideo: mediaDir ? { dir: mediaDir, size: { width: 390, height: 844 } } : undefined,
	});
	await context.addInitScript((startTime) => {
		const performanceStart = performance.now();
		Date.now = () => startTime + performance.now() - performanceStart;
	}, Date.parse('2099-08-07T04:59:54Z'));
	const page = await context.newPage();
	await page.goto(`${baseUrl}/flyer-qa/`);
	assert.equal(await page.locator('[data-flyer-announcement]').count(), 1);
	await page.waitForTimeout(900);
	assert.equal(await page.locator('[data-flyer-modal][aria-hidden="false"]').count(), 1);
	if (mediaDir) await page.screenshot({ path: join(mediaDir, 'flyer-before-expiration-mobile-390.png'), fullPage: true });
	await page.waitForFunction(() => !document.querySelector('[data-flyer-announcement]'), null, { timeout: 10_000 });
	assert.equal(await page.locator('[data-flyer-announcement]').count(), 0);
	if (mediaDir) await page.screenshot({ path: join(mediaDir, 'flyer-after-expiration-mobile-390.png'), fullPage: true });

	await page.goto(`${baseUrl}/flyer-qa-no-expiration/`);
	await page.waitForTimeout(1000);
	assert.equal(await page.locator('[data-flyer-announcement]').count(), 1);
	if (mediaDir) await page.screenshot({ path: join(mediaDir, 'flyer-no-expiration-mobile-390.png'), fullPage: true });
	await page.waitForTimeout(3500);
	await page.close();
	await context.close();

	const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
	await desktop.addInitScript(() => {
		Date.now = () => Date.parse('2099-08-07T04:59:59Z');
	});
	const desktopPage = await desktop.newPage();
	await desktopPage.goto(`${baseUrl}/flyer-qa/`);
	assert.equal(await desktopPage.locator('[data-flyer-announcement]').count(), 1);
	if (mediaDir) await desktopPage.screenshot({ path: join(mediaDir, 'flyer-before-expiration-desktop-1440.png'), fullPage: true });
	await desktop.close();

	console.log('PASS: America/Chicago flyer remains visible through configured date');
	console.log('PASS: same prebuilt HTML removes flyer after Central-Time midnight');
	console.log('PASS: viewer timezone does not change the server-computed cutoff');
	console.log('PASS: omitted expiration remains visible indefinitely');
	if (mediaDir) {
		const media = statSync(mediaDir);
		assert(media.isDirectory());
		console.log(`MEDIA: ${mediaDir}`);
	}
} finally {
	await browser.close();
	await new Promise((resolveClose) => server.close(resolveClose));
	rmSync(fixture, { recursive: true, force: true });
}
