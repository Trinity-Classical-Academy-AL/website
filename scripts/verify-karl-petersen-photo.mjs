import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const expected = {
	sha256: '308ec2c9bc735ec5f7ab1a1ad3e619daf9a903eee579726ff4029edbf2a9c06f',
	format: 'jpeg',
	width: 1068,
	height: 1280,
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = fileURLToPath(import.meta.url);
const portraitPath = process.env.VERIFY_PORTRAIT_SOURCE
	? path.resolve(process.env.VERIFY_PORTRAIT_SOURCE)
	: path.join(repoRoot, 'src/assets/images/karl-petersen.jpeg');
const peopleSourcePath = process.env.VERIFY_PEOPLE_SOURCE
	? path.resolve(process.env.VERIFY_PEOPLE_SOURCE)
	: path.join(repoRoot, 'src/pages/people.astro');
const builtPeoplePath = path.join(repoRoot, 'dist/people/index.html');

const peopleSource = await readFile(peopleSourcePath, 'utf8');
assert.match(
	peopleSource,
	/import karlImg from '\.\.\/assets\/images\/karl-petersen\.jpeg';/,
	'The people page must import Karl\'s approved portrait asset',
);
assert.match(
	peopleSource,
	/\{ name: 'Karl Petersen',\s+title: 'Chair',\s+image: karlImg/,
	'Karl\'s board card must use the approved portrait import',
);

const boardStart = peopleSource.indexOf('<!-- ====== BOARD OF DIRECTORS ====== -->');
const boardEnd = peopleSource.indexOf('<!-- ====== ADMINISTRATION ====== -->');
assert.ok(boardStart >= 0 && boardEnd > boardStart, 'Board section boundaries are missing');
const boardSection = peopleSource.slice(boardStart, boardEnd);

for (const layoutToken of [
	'aspect-[4/5]',
	'object-cover',
	'grid-cols-1',
	'sm:grid-cols-2',
	'lg:grid-cols-3',
]) {
	assert.ok(boardSection.includes(layoutToken), `Board card layout token is missing: ${layoutToken}`);
}

if (process.argv.includes('--self-test-layout')) {
	const fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'tca-karl-layout-'));
	const fixturePath = path.join(fixtureDir, 'people-broken-layout.astro');
	try {
		const brokenSource = peopleSource.replace('aspect-[4/5]', 'aspect-square');
		assert.notEqual(brokenSource, peopleSource, 'Layout self-test could not perturb the board card');
		await writeFile(fixturePath, brokenSource);
		const result = spawnSync(process.execPath, [scriptPath], {
			cwd: repoRoot,
			encoding: 'utf8',
			env: { ...process.env, VERIFY_PEOPLE_SOURCE: fixturePath },
		});
		assert.notEqual(result.status, 0, 'Layout verifier accepted a broken board-card aspect ratio');
		assert.match(
			`${result.stdout}\n${result.stderr}`,
			/Board card layout token is missing: aspect-\[4\/5\]/,
			'Layout verifier failed for an unexpected reason',
		);
		console.log(JSON.stringify({
			status: 'pass',
			selfTest: 'layout guard rejects a board card without aspect-[4/5]',
		}, null, 2));
	} finally {
		await rm(fixtureDir, { recursive: true, force: true });
	}
	process.exit(0);
}

const portrait = await readFile(portraitPath);
const digest = createHash('sha256').update(portrait).digest('hex');

if (process.argv.includes('--red-photo-check')) {
	if (digest === expected.sha256) {
		console.error('RED SETUP FAILED: the approved Karl portrait is already installed');
		process.exit(2);
	}
	assert.equal(
		digest,
		expected.sha256,
		`APPROVED PORTRAIT CHECK FAILED: Karl portrait digest ${digest} does not match the approved digest ${expected.sha256}`,
	);
}

assert.equal(digest, expected.sha256, 'Karl portrait does not match the approved upload digest');

const metadata = await sharp(portrait).metadata();
assert.equal(metadata.format, expected.format, 'Karl portrait must remain a JPEG');
assert.equal(metadata.width, expected.width, 'Karl portrait width changed');
assert.equal(metadata.height, expected.height, 'Karl portrait height changed');

const builtPeople = await readFile(builtPeoplePath, 'utf8');
const builtAssetMatch = builtPeople.match(/\/_astro\/karl-petersen\.[^"']+\.webp/);
assert.ok(builtAssetMatch, 'The built people page does not reference Karl\'s optimized portrait');

const builtAssetPath = path.join(repoRoot, 'dist', builtAssetMatch[0]);
const builtAsset = await stat(builtAssetPath);
assert.ok(builtAsset.size > 0, 'Karl\'s optimized portrait is empty');

console.log(JSON.stringify({
	status: 'pass',
	portrait: {
		path: path.relative(repoRoot, portraitPath),
		sha256: digest,
		format: metadata.format,
		width: metadata.width,
		height: metadata.height,
	},
	peoplePage: {
		path: path.relative(repoRoot, peopleSourcePath),
		boardEntry: 'Karl Petersen — Chair — karlImg',
		cardAspectRatio: '4/5',
		responsiveColumns: ['1', 'sm:2', 'lg:3'],
		imageFit: 'object-cover',
	},
	builtAsset: {
		path: path.relative(repoRoot, builtAssetPath),
		bytes: builtAsset.size,
	},
}, null, 2));
