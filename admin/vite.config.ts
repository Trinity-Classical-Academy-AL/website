import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [tailwindcss()],
	server: {
		fs: { allow: [path.resolve(root, '..')] },
		proxy: {
			'/api': 'http://127.0.0.1:4321',
		},
	},
});
