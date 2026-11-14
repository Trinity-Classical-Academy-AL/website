Lane B client asset verification, November 14, 2026, branch `perf/client-assets`.

Replaced the shell's Ark/React account and mobile menus with an Astro-rendered native desktop popover and a small delegated controller for the existing mobile overlay. Settings and sign-out keep their URLs, POST method, CSRF field, and session behavior. Escape, Tab/Enter, focus return, backdrop dismissal, and menu reset on navigation work without React hydration. Pages without content islands load no React.

CSS URLs now include a digest of all four public stylesheets. Netlify rules give CSS `max-age=3600, stale-while-revalidate=604800`, images `max-age=86400, stale-while-revalidate=604800`, and hashed `/_astro/*` assets a year of immutable caching. Removed the incorrect immutable rule for the unhashed fonts stylesheet. Its persistence key includes the digest. Authenticated HTML explicitly returns `private, no-store` and `Netlify-CDN-Cache-Control: no-store`.

Prefetch is opt-in: viewport for desktop sidebar links, tap for mobile navigation, hover for account Settings. Forms, sign-out, exports, downloads, and auth endpoints are excluded. The sidebar persists only for matching account/name/CSRF/role context and updates its active link from the new page's current-route marker. Desktop main-container scrolling restores on back/forward and starts at zero for new entries. The submit listener is registered once across ClientRouter swaps.

Font files, metrics, and `font-display: optional` are unchanged. Removed Geist 700 and Plex Mono preloads only on the verified sign-in screens (`/`, `/signup`, `/password`, `/forgot`, `/reset-expired`, `/google-unavailable`, `/interested`). Other pages retain all six: removing the remaining weights or mono face produced visible fallback text in headings, tables, and navigation labels.

Login font preloads: 6 → 4; 233,708 → 183,336 bytes (49.2 KiB removed).

Measurements use the actual Netlify build through `tests/e2e/preview.mjs`, with fresh browser contexts and a stable local seed. JS totals sum gzip sizes of unique external JS resources plus the concatenated inline scripts. HTML is raw response size. No production portal requests or deployment were needed.

| Page | Total JS gzip, KiB before → after | HTML bytes before → after |
| --- | ---: | ---: |
| `/` | 6.4 → 6.7 | 5,150 → 4,979 |
| `/home` | 117.2 → 8.0 | 24,773 → 22,145 |
| `/g` | 117.2 → 8.0 | 19,619 → 17,159 |
| `/admin` | 117.2 → 8.0 | 20,519 → 18,240 |
| `/admin/tours` | 122.5 → 93.3 | 33,129 → 35,996 |

Admin tours still needs React/Ark for its two existing content-tab islands. Its HTML increases because that page retains the island bootstrap alongside the new inline shell controller and server-rendered account sheet. The other three authenticated page types lose the shell islands and their bootstrap entirely.

| Mobile Lighthouse | Score before → after | FCP/LCP seconds before → after | CLS before → after | Local transfer bytes before → after |
| --- | ---: | ---: | ---: | ---: |
| login | 100 → 100 | 1.35 / 1.35 → 1.35 / 1.35 | 0 → 0 | 334,398 → 284,702 |
| guardian | 100 → 100 | 1.50 / 1.50 → 1.50 / 1.50 | 0 → 0 | 692,097 → 347,665 |

These are single local Lighthouse runs on a shared machine, using a seeded guardian cookie for `/g`. The preview serves uncompressed assets, so transfer totals are not production/CDN totals. Timing differences are noise; both pages retain a score of 100 and zero CLS.

Validation passed: `cd portal && npx astro build`; `node --test --test-concurrency=1 tests/*.test.mjs` (77/77, DATABASE_URL set); existing portal e2e flows; and new menu/navigation/POST sign-out checks at 1440×900 and 390×844. Sign-out clears the session cookie through the replacement controls at both widths. Browser tests use one Chromium at a time. Unit tests use the supplied `tca` database; browser tests use the additive local `tca_client_assets` database because the unit suite truncates its database.

The visual matrix covers 117 pairs of page, sheet, dialog, and menu screenshots across anonymous, prospect, guardian, and admin views. All pairs have zero changed pixels under pixelmatch's threshold 0.1/default anti-alias handling. A full matrix was followed by focused reruns of the three mobile account popups after replacing native top-layer rendering with the original overlay stacking context. Screenshots, diffs/results, Lighthouse reports, per-page byte measurements, and traces are in `/home/bryant/work/tca/perf-shots/client-assets/`. The scripts support `PERF_SEED`, `PERF_SHOTS`, `PERF_STAGE`, and `PORTAL_E2E_URL`; browser dependencies are Playwright, pngjs, pixelmatch, and Lighthouse.

Final navigation traces sampled 25 animation frames across both widths, with zero frames missing content or navigation chrome. Browser checks also cover persistent sidebar identity/current-link state, viewport resizing, and main-container history restoration. Traces are `after/navigation-1440.zip` and `after/navigation-390.zip`.

Deferred work and limits: the single content tree was reverted when mobile dialog placement and autofocus visibly changed. Existing content duplication and `-m` IDs remain. Remaining content islands retain eager hydration: selects/password fields and open dialogs need immediate behavior, and RouteTabs depends on hydration to draw its active underline. The seeded guardian form-detail route already returns 500 (`assignment.questions.map is not a function`) on HEAD; it is recorded as a baseline coverage gap and left to the data lane. Netlify edge headers and Safari/Firefox behavior have not been exercised locally. No school package, ClassReach behavior, schema migration, page data loading, email send, push, or deploy was changed. All started preview servers and browsers were shut down.

The requested commit is blocked by the environment: Git cannot create `website/main/.git/worktrees/website-perf-client/index.lock` because the Git metadata is mounted read-only. Source changes remain on the current branch for review; a patch is saved with the screenshot artifacts as `client-assets.patch`.
