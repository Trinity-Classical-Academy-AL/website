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

/**
 * Serves the admissions API during `astro dev` with a file-backed store.
 * Production uses the Netlify Functions, which talk to Netlify Blobs.
 * @returns {import('vite').Plugin}
 */
function admissionsDevApi() {
  return {
    name: 'admissions-dev-api',
    configureServer(server) {
      process.env.ADMISSIONS_STORE = 'file';
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        const handled =
          path.startsWith('/api/banner') ||
          path === '/api/tours' ||
          path === '/api/tour-requests' ||
          path === '/api/interest' ||
          path === '/api/updates' ||
          path.startsWith('/api/admin');
        if (!handled) {
          next();
          return;
        }
        try {
          const { handleAdmissionsRequest } = await import('./src/lib/admissions/http.ts');
          const request = await nodeRequestToFetch(req);
          const response = await handleAdmissionsRequest(request);
          res.statusCode = response.status;
          const cookies = response.headers.getSetCookie?.() ?? [];
          response.headers.forEach((value, key) => {
            if (key.toLowerCase() === 'set-cookie') return;
            res.setHeader(key, value);
          });
          if (cookies.length) res.setHeader('set-cookie', cookies);
          const bytes = Buffer.from(await response.arrayBuffer());
          res.end(bytes);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

/**
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<Request>}
 */
function nodeRequestToFetch(req) {
  const host = req.headers.host || '127.0.0.1';
  const url = new URL(req.url ?? '/', `http://${host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    return Promise.resolve(new Request(url, { method: req.method, headers }));
  }
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      resolve(new Request(url, { method: req.method, headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
  });
}

export default defineConfig({
  // Astro 7 defaults to "jsx" whitespace handling, which drops the space between inline tags and following text (e.g. "Academyis"). Keep Astro 6 behavior.
  compressHTML: true,
  site: 'https://trinityclassical.academy',
  integrations: [
    sitemap({
      filter: (page) =>
        !page.includes('/brand-guide') &&
        !page.includes('/our-philosophy') &&
        !page.includes('/admin'),
      serialize(item) {
        const lastmod = lastmodForPage(item.url);
        if (lastmod) item.lastmod = lastmod;
        return item;
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss(), admissionsDevApi()]
  }
});
