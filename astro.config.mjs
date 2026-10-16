// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://trinityclassical.academy',
  integrations: [
    sitemap({
      filter: (page) =>
        !page.includes('/brand-guide') &&
        !page.includes('/our-philosophy'),
    }),
  ],
  vite: {
    plugins: [tailwindcss()]
  }
});
