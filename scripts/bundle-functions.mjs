import { mkdir, rm } from 'node:fs/promises';
import esbuild from 'esbuild';

const outdir = 'netlify/functions-dist';
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

await esbuild.build({
	entryPoints: ['netlify/functions/admissions-public.ts', 'netlify/functions/curriculum-content.ts'],
	outdir,
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'node22',
	outExtension: { '.js': '.mjs' },
	logLevel: 'info',
});
