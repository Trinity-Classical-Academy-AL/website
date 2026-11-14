# Portal server and data performance

Measured locally on 2026-11-14, branch `perf/server-data`. The portal production
build ran through the Netlify `createHandler` entry point, with
`NODE_ENV=production`, Node 22.23.4, and Postgres on `127.0.0.1:55432`.
Both versions used the same four e2e seed families (two guardians, one prospect,
one administrator), documents, forms, and sessions. The database was isolated as
`tca_perf_server_a` because other work was resetting the shared `tca` fixtures.
No emails, webhooks, deployments, or ClassReach synchronization were run.

## Measurements

Warm request results are medians of 11 sequential HTTP requests per route.
TTFB measures arrival of HTTP response headers. Counts are application SQL
queries; the driver performs one additional type-discovery query on a new
connection. The original build was temporarily instrumented with postgres.js's
`debug` callback, counting calls without logging SQL or parameters. The updated
build exposes the counts in `Server-Timing`.

| Route | Queries before → after | Median TTFB ms before → after | p90 TTFB ms before → after |
| --- | ---: | ---: | ---: |
| `/admin` | 9 → 4 | 8.54 → 5.34 | 10.56 → 6.62 |
| `/admin/tours` | 14 → 5 | 9.27 → 5.11 | 9.95 → 6.46 |
| `/admin/families` | 21 → 2 | 10.81 → 3.63 | 14.64 → 4.72 |
| `/g` | 10 → 5 | 5.24 → 3.42 | 6.20 → 4.41 |
| `/account` | 18 → 6 | 12.01 → 5.22 | 15.76 → 6.47 |
| `/home` | 12 → 5 | 7.06 → 3.77 | 8.06 → 5.12 |
| `/admin/prospects` | 28 → 4 | 13.58 → 3.98 | 15.18 → 4.97 |
| `/admin/staff` | 19 → 2 | 9.45 → 3.33 | 11.00 → 3.99 |
| `/` without a session | 0 → 0 | 0.78 → 0.69 | 0.99 → 0.93 |

Five fresh Node processes per version measured `dbReady()` at a median
90.6 → 13.6 ms. SQL calls fell from 72 → 2 including driver discovery, or
71 → 1 for schema readiness alone. A changed schema took 9 protocol queries,
including the transaction and driver discovery, with the existing schema and
compatibility SQL sent as one simple-protocol batch. The marker is committed
only after that batch succeeds. The first `/admin` request in a fresh HTTP
server measured 204.9 → 110.4 ms; these are single observations, not percentiles.
This local database has no Neon network latency or Netlify scheduling delay;
these results do not predict production milliseconds.

## Changes and checks

- Hash all schema, existing compatibility migrations, and backfill SQL. Check
  the durable version before applying it. Serialize changes with a transaction
  advisory lock and recheck after locking. Preserve existing migration SQL.
- Reuse `locals.family` throughout portal pages and downloads. Normal migrated
  family reads use one query, retaining legacy email and notification repair.
- Load independent page queries concurrently; batch admin lists, default tour
  slot inserts, prospect children, tour dates, and form assignment writes.
  `dashboardCounts()` already combined its counts in one SQL statement.
- Add indexes for family-email ownership, rate limits, students, prospect
  children, tour holds/requests/bookings, activity, assignments, tokens, and events.
  Email uniqueness indexes already exist. TCA authentication uses signed cookies,
  with no database sessions table to index.
- Disable unused Astro sessions and their Netlify Blobs driver. Document and
  flyer byte storage still uses the existing storage paths.
- Keep `max: 1`, preparation behavior, `idle_timeout: 20`, and
  `connect_timeout: 10` unchanged.
- `Server-Timing` includes middleware elapsed time (`total`), time with pending
  application SQL (`db`, including connection/queue waits, with overlaps counted
  once), and query count (`queries;desc="4"`). It contains no SQL or identifiers.
  Driver discovery, implicit transaction control, platform startup, and streaming
  body completion are outside these application metrics. Astro can reject a
  cross-origin request before middleware, so that response has no timing header.

Validation: the portal production build passed; all 80 unit/integration tests
passed with a local database; targeted TypeScript checking passed. The e2e flows
passed against the production build, including document isolation, role gates,
auth redirects, mobile navigation, and added timing/query-count checks. Tests
also cover concurrent stale-marker repair, failed migration rollback and retry,
lazy queries/builders, request counter isolation, legacy repair, bounded list
queries, and grade-based assignment idempotence. Two independent clients also
successfully bootstrapped a separate empty local database concurrently.

A schema version change still takes table locks while applying existing ALTERs
and creating indexes. That happens once per version; it needs observation after
release. Production latency and bundle size must be checked on Netlify after
review. React server rendering remains an external dependency, with development
and production implementations selected by its existing Node entry point; no
renderer surgery or ClassReach/email import changes were attempted. Email send
loops and legacy-import loops remain unchanged to preserve delivery/failure
semantics; request-time data list loops were removed.

## Reproduce the updated measurements

```sh
export PATH=$HOME/.local/node-v22.23.4-linux-x64/bin:$PATH
export CI=1 DATABASE_URL=postgres://tca:tca@127.0.0.1:55432/tca
export FAMILY_SESSION_SECRET=ci-family-secret ADMISSIONS_STORE=file
export ADMISSIONS_DATA_DIR="$PWD/.data/admissions"
export RESEND_API_KEY='' SCHOOL_NOTIFY_WEBHOOK_URL=''
export PORTAL_E2E_URL=http://127.0.0.1:4391
node --test --test-concurrency=1 tests/*.test.mjs
node tests/e2e/seed.mjs
(cd portal && npx astro build)
NODE_ENV=production node tests/e2e/serve-built.mjs
# In another terminal with the same exports:
node tests/e2e/measure-server.mjs
export CHROME_PATH=$(ls -d ~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome | sort -V | tail -1)
node tests/e2e/flows.playwright.mjs
# Shut down the server using the PID printed at startup:
kill <PID>
```

Use a separate local database if other lanes are running tests. The existing
admissions test resets its database, so seed after unit tests. The local server
has no watcher, binds only to 127.0.0.1 on ports 4390–4399, and disables email and
school webhooks. The flow runner closes Chromium even if an assertion fails.
