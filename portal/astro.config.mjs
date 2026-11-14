import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import netlify from '@astrojs/netlify';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

const root = path.dirname(fileURLToPath(import.meta.url));
const cssHash = createHash('sha256');
for (const file of ['fonts.css', 'portal.css', 'responsive.css', 'app.css']) {
	cssHash.update(readFileSync(path.join(root, 'public/css', file)));
}
const cssVersion = cssHash.digest('hex').slice(0, 12);

export default defineConfig({
	output: 'server',
	// Authentication uses signed TCA cookies; Astro sessions are unused.
	session: false,
	prefetch: { prefetchAll: false, defaultStrategy: 'tap' },
	adapter: netlify(),
	integrations: [react()],
	site: 'https://portal.trinityclassical.academy',
	vite: {
		define: { 'import.meta.env.PORTAL_CSS_VERSION': JSON.stringify(cssVersion) },
		plugins: [tailwindcss()],
		envDir: path.resolve(root, '..'),
		server: { fs: { allow: [path.resolve(root, '..')] } },
		ssr: { noExternal: ['@tca/school'], external: ['postgres', '@netlify/blobs'] },
	},
});
