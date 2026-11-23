import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('shell account actions keep POST and CSRF with explicit navigation prefetch', () => {
  for (const file of ['AccountMenu', 'MobileMenu']) {
    const source = read(`portal/src/components/${file}.astro`);
    assert.match(source, /method="post" action="\/sign-out"/);
    assert.match(source, /name="csrf" value=\{csrf\}/);
    assert.match(source, file === 'AccountMenu' ? /popover="auto"/ : /data-mobile-account/);
    assert.match(source, /aria-controls=/);
    assert.doesNotMatch(source, /@ark-ui|react/);
  }
  // Astro's prefetch is off; ours keeps a short-lived copy the router reuses, cleared on any submit.
  assert.match(read('portal/astro.config.mjs'), /prefetch: false/);
  const prefetch = read('portal/src/scripts/prefetch.ts');
  assert.match(prefetch, /auth\|dev\|api\|sign-out/);
  assert.match(prefetch, /export/);
  assert.match(prefetch, /addEventListener\('submit', \(\) => cache\.clear\(\), true\)/);
  assert.doesNotMatch(read('portal/src/layouts/PortalLayout.astro'), /data-astro-prefetch[^>]*href="\/(sign-out|auth\/|.*-export)/);
});

test('public CSS uses a content digest and static caching never marks HTML immutable', () => {
  const config = read('portal/astro.config.mjs');
  assert.match(config, /createHash\('sha256'\)/);
  assert.match(config, /public\/css/);
  assert.match(read('portal/src/lib/assets.ts'), /\?v=/);
  for (const layout of ['PortalLayout', 'AuthLayout', 'SignLayout']) assert.match(read(`portal/src/layouts/${layout}.astro`), /cssHref/);
  const headers = read('portal/netlify.toml');
  assert.match(headers, /for = "\/_astro\/\*"\s+\[headers.values\]\s+Cache-Control = "public, max-age=31536000, immutable"/);
  assert.match(headers, /stale-while-revalidate=604800/);
  assert.doesNotMatch(headers, /for = "\/css\/fonts.css"/);
  assert.match(read('portal/src/middleware.ts'), /Cache-Control', 'private, no-cache'/);
  assert.match(read('portal/src/middleware.ts'), /Netlify-CDN-Cache-Control', 'no-store'/);
});
