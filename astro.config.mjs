// @ts-check
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

/**
 * lastmod from the page source's latest commit. Omitted when git history
 * is unavailable, rather than stamped with the build clock.
 * @param {string} pageUrl
 * @returns {string | undefined}
 */
function lastmodForPage(pageUrl) {
  const pathname = new URL(pageUrl).pathname.replace(/\/$/, '');
  const rel = pathname === '' ? 'index' : pathname.slice(1);
  const file = [
    join('src/pages', `${rel}.astro`),
    join('src/pages', rel, 'index.astro'),
  ].find((candidate) => existsSync(candidate));
  if (!file) return undefined;
  try {
    const iso = execFileSync('git', ['log', '-1', '--format=%cI', '--', file], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

// https://astro.build/config
export default defineConfig({
  // Astro 7 defaults to "jsx" whitespace handling, which drops the space between inline tags and following text (e.g. "Academyis"). Keep Astro 6 behavior.
  compressHTML: true,
  site: 'https://trinityclassical.academy',
  integrations: [
    sitemap({
      filter: (page) =>
        !page.includes('/brand-guide') &&
        !page.includes('/our-philosophy'),
      serialize(item) {
        const lastmod = lastmodForPage(item.url);
        if (lastmod) item.lastmod = lastmod;
        return item;
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()]
  }
});
