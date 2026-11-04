import path from 'node:path';
import { fileURLToPath } from 'node:url';
import netlify from '@astrojs/netlify';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	output: 'server',
	adapter: netlify(),
	integrations: [react()],
	site: 'https://portal.trinityclassical.academy',
	vite: {
		plugins: [tailwindcss()],
		envDir: path.resolve(root, '..'),
		server: { fs: { allow: [path.resolve(root, '..')] } },
		ssr: { noExternal: ['@tca/school'], external: ['postgres', '@netlify/blobs'] },
	},
});
