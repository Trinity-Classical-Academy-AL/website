# Portal releases

The portal is live. A change merges only after the checks below are green.

1. Unit tests in `tests/*.test.mjs`.
2. The Playwright flow suite in `tests/e2e`, run in CI against a seeded Postgres database. It covers sign-in, guardian home, tours, documents (including a second family guessing an id), forms, announcements, admin pages, mobile nav, 404, and no-access.
3. Database changes are additive. Do not drop or rename a column in the same release that stops reading it. Add the new shape, ship readers, then remove the old shape later.
4. Auth and session behavior changes need a test that fails if the cookie, expiry, or role gate moves.
5. After production deploy, open https://portal.trinityclassical.academy/health and the sign-in page. If either is wrong, roll back before the next change.

## Rollback

Netlify keeps the previous production deploy. In the portal site (tca-portal-al): Deploys → the previous successful production deploy → Publish deploy. That is the instant rollback. Do the same for the public site only if that deploy changed it. The database is not rolled back by Netlify. Because migrations are additive, the previous build still reads the current tables.

## Email and backups

SPF for trinityclassical.academy does not include Resend. DKIM at `resend._domainkey` is present, and DMARC is `p=quarantine`. Bryant needs to add Resend’s SPF include before portal mail is reliable. Neon backups and a restore drill are not visible from this repo; confirm both in the Neon project before relying on them.

## Errors

No PostHog key is available here. Denied document downloads and health failures write one JSON line to the server log (`document_denied`, `health_failed`). Point those logs at an alert when a log drain exists.
