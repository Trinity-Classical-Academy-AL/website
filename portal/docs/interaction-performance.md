# Interaction performance and verification

Measured on local Chromium against the same Astro server harness and local Postgres, with each HTML/fetch response delayed by 250 ms. The server's file watcher was closed for these checks. `tests/e2e/interaction-measure.playwright.mjs` records `performance.timeOrigin + performance.now()` at the actual click event and samples the first animation frame showing the outcome. The measurement survives full document navigations via sessionStorage. Before and after use the same script and fixtures; these are single representative samples, not production percentiles.

| Action | Before, click to visible change | After | After reconciliation | Full reloads before → after | Document requests before → after |
| --- | ---: | ---: | ---: | --- | --- |
| Open tour add sheet | 325 ms | 7 ms | 7 ms | 0 → 0 | 0 → 0 |
| Save tour time | 360 ms | 12 ms | 10 ms | 1 → 0 | 2 → 0 |
| Save student | 354 ms | 12 ms | 10 ms | 1 → 0 | 2 → 0 |
| Publish document | 346 ms | 12 ms | 16 ms | 1 → 0 | 2 → 0 |
| Enroll prospect | 345 ms | 11 ms | 15 ms | 1 → 0 | 2 → 0 |

Raw samples are recorded in `interaction-performance.json`. The reconciliation column is a fresh single-sample run against the Netlify build preview on port 4393 and local `tca_c2`; the before/original-after samples are retained from the earlier run. The response delay remains 250 ms.

The two baseline document requests are the POST and its redirected GET; they replace the document once. Enhanced mutations still make a POST and follow the server redirect as a fetch. Their list/sheet feedback is immediate; the database work and final authoritative HTML still take the normal server time. No requests are skipped, replayed, or reported as committed before the response. The tour add sheet opens locally without requesting HTML.

26 source form occurrences previously forced reloads. 25 now use ClientRouter; email-first sign-in retains reload because its POST can lead to Google OAuth. Google links retain explicit full navigation. Existing downloads still use attachment endpoints.

## Reconciliation with the client-assets shell

The interaction module is the sole owner of submit busy state and scroll restoration.
The shell retains delegated native menu behavior and persisted-sidebar route updates.
Submitters are serialized before disabling, and spinners appear only after 150 ms.

Before each ClientRouter preparation, the interaction module snapshots window,
`.portal-main`, mobile content, and sheet scroll positions. Same-path POST redirects
and query navigations restore that snapshot; different pathnames start at the top;
history traversals restore the destination entry. This decision uses the final URL
after redirects. A second restore at page-load covers incoming component layout.
The interaction layer keeps tap prefetch and no longer adds a hover/focus prefetch
listener over the shell's policy. Local dialogs still avoid requests entirely.

`reconciled-shell.playwright.mjs` exercises both 1440 px and 390 px viewports,
including sheet open/close swaps, tabs, server search, same-path POSTs, new paths,
back/forward, persisted-sidebar identity, and delayed single-spinner rollback.
The native and enhanced POST busy probes each preserve the submitter, issue one
request, delay the spinner, and clean up after a swap or rollback. All five browser
suites pass against the production SSR build. The navigation suite observed zero
blank frames in 19 desktop and 7 mobile samples, with no React/menu chunks on the
guardian shell.

ArkDialog and RouteTabs now import the already-loaded router directly. Dynamic
imports had caused the build to place a shared namespace helper in a React chunk,
which the native shell then fetched. The direct imports eliminate that dependency
without changing dialog or tab behavior.

`client-navigation.playwright.mjs` now creates its artifact directory under the
system temporary directory by default so it can also run in CI.

## Verification

- `node --test --test-concurrency=1 tests/*.test.mjs`: full unit/DB suite, 92 passing tests, including ten interaction regressions. `linkedom` is a locked development dependency.
- `cd portal && npx astro build`: production SSR build.
- Scoped TypeScript check for the three new scripts.
- `tests/e2e/flows.playwright.mjs`: existing flows, plus real password sign-in verifies Set-Cookie and that the document survives the native Astro POST/redirect.
- `tests/e2e/optimistic.playwright.mjs`: real saves, optimistic inquiry status and persisted status, forced HTTP/network/200-with-error failures, no duplicate POST, field validation with retained draft, same-page scroll/focus, instant sheet/no blank frame/Escape, delete rollback, local filtering, server search caret/tab/filter persistence, desktop/mobile previews after swaps, mobile save, no-JS POST.
- `tests/e2e/optimistic-forms.playwright.mjs`: 30 serial transport probes cover all removed form reloads, multipart file bytes, CSRF, submitter `publish`/`action` fields, external-form buttons, and account dialogs. Email-capable POSTs are intercepted before reaching the server. These verify transport and rollback; they do not verify email delivery or server business logic for those operations.
- Client navigation and reconciliation regressions run alongside both optimistic suites, serially after existing flows in `portal-e2e.yml`. No browser/server is left running after local verification.

For local reproduction, use the seed and environment described in `.github/workflows/portal-e2e.yml`, Node 22.23.4 or newer, an available 4390–4399 port, and the installed Chromium via `CHROME_PATH`. The reconciliation checks used the existing isolated `tca_c2` database on the supplied Postgres container. All 92 unit/DB tests, the production build, scoped TypeScript checks, and all five serial browser suites passed. No production service was contacted or deployed.

## Risks and deferred work

- The preparation hook supplies the same Netlify deploy header as Astro's ClientRouter. Production integration still needs the user's normal review/deployment; no live deployment was performed.
- An interrupted request may already have committed. The layer restores visible state and never retries it automatically; the user should check before retrying.
- Existing layout duplication emits React mobile hydration ID warnings; this lane's attributes and scoped bindings work with one or two copies. Layout cleanup is deferred to its lane.
- `saveSchoolForm`/seed JSON serialization can leave `questions` as an encoded JSON string, causing guardian detail pages to throw. The transport test normalizes only its own fixture. Fixing the shared server serializer is deferred because `packages/school/src` is excluded here.
- Existing student removal and announcement draft deletion have no separate confirmation. Existing confirmations remain intact; adding a new required step is deferred for product review.
- Tracker reminder CSRF rejection lacks a page error banner. Its business logic is unchanged; validation consistency belongs to a follow-up/server review.
