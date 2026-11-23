# Handoff: ship `families/merge-and-activity` to production as-is

You are taking this branch from "pushed" to "live and verified". Ship it as it is: no new features, no redesigns. Fix only what blocks the release, and stop for the human at every gate marked **HUMAN**.

The full plan, with the reasons behind it, is `docs/releases/2026-11-classroom.md`. Read it first. This file is the order of work and the rules.

## Facts

- **Repo:** `github.com/Trinity-Classical-Academy-AL/website`. The branch `families/merge-and-activity` is pushed (about 92 commits ahead of `main` at `87d06ef`). No PR yet.
- **Netlify sites:** all three deploy production from `main`, team `start-ups`, and share one Neon Postgres database.
  - `tca-portal-al` (portal.trinityclassical.academy, base `portal/`)
  - `tca-admin-al` (base `admin/`)
  - `tcabham` (trinityclassical.academy, repo root)
- **Previews and branch deploys:** deploy previews are **on** for all three. Branch deploys are limited to `main`, so pushing a branch deploys nothing, but opening a PR builds previews.
- **Database migration:** runs inside the app on its first request (`dbReady()` in `packages/school/src/db.ts`), as one transaction, keyed by a hash of the schema. There is no separate migrate command.
- **CI** (GitHub Actions, on pull requests only):
  - `portal-e2e`: every `tests/*.test.mjs` on a fresh Postgres, then the seed, then `tests/e2e/flows.playwright.mjs`.
  - `portal-ui-gates`: `node portal/ui-eval/run.mjs`.
- **Local dev:** `node scripts/dev/local.mjs` starts Postgres in Docker (`tca-dev-postgres`, port 55440, database `tca_dev`) and Astro on http://127.0.0.1:3500.

## Rules

1. **Never** run the test suite against `tca_dev` or production. `tests/admissions.test.mjs` truncates every table. Use a throwaway database:
   `docker run -d --name tca-test -p 127.0.0.1:55443:5432 -e POSTGRES_USER=tca -e POSTGRES_PASSWORD=tca -e POSTGRES_DB=t postgres:17`
   Then: `DATABASE_URL=postgres://tca:tca@127.0.0.1:55443/t node --test --test-concurrency=1 tests/*.test.mjs`. Recreate the container for each full run.
2. **Don't open the PR** until the human confirms the deploy-preview database (Gate A).
3. **Never** force-push, rewrite history, or push to `main` directly. Merge only through the PR, and only at Gate C.
4. **Never** print or commit secrets: the Neon connection string, Resend key, Formaloo keys, session secret. The human passes the connection string with `DATABASE_URL="$(pbpaste)"`, and it must stay out of logs.
5. Only send email the human asked for. Developer → Emails → "Send me a test" goes to the person signed in, which is fine.
6. Don't change behavior. Only fixes that make CI pass, or that fix a bug found while verifying. If a fix needs a product decision, ask.
7. Commit messages end with the attribution line the session gives you. Write plainly.

## Known state of the tests

On a fresh database: 568 tests, with every failure introduced by this branch fixed. These were **already failing on `main`**; leave them alone and say so in the PR:

| Test | File |
| --- | --- |
| a full tour date rejects the next family | `tests/admissions.test.mjs` |
| saved forms keep questions and answers as jsonb | `tests/forms-jsonb.test.mjs` |
| account RSVP upserts … legacy compatibility | `tests/rsvp-account.test.mjs` |
| family reads repair legacy accounts … bounded queries | `tests/server-performance.test.mjs` |
| info-night: **hangs forever** | `tests/info-night.test.mjs` |

Because info-night hangs, the full run never finishes on its own. Locally, kill that process to continue. In CI it would hang `portal-e2e` until it times out, so you must deal with it (Step 1).

## Step 1: make CI pass (you)

1. **info-night hang.** Find why it never finishes; it hangs on `main` too. Most likely an open database handle or a server that's never closed. Fix the test so it exits. If the cause is real product code, stop and report it. Don't paper over it.
2. **`portal-e2e` CI job.** Read `.github/workflows/portal-e2e.yml`. If the job fails on the pre-existing failures above, mark those tests `skip` with a comment naming this release and "already failing on main". Don't delete them.
3. **Playwright flows** (`tests/e2e/flows.playwright.mjs`) still expect the old app. Update the expectations to what the branch intends:
   - `/g` now says "Needs your attention", not "Forms to do".
   - `/admin/tours?sheet=add` now redirects to the calendar (tours live there). Expect the redirect, or test adding a time on `/admin/calendar`.
   - The query-count guard expects `/admin` 4, `/admin/tours` 5, `/admin/families` 2, `/g` 5, `/account` 6, `/home` 6. Measured on this branch: 19, 2 (a redirect now), 8, 10, 18, 10. First try to cut the obvious waste on `/admin` (Overview) and `/account`. Look for queries in loops and work done twice. Don't change what the pages show. Then set each guard to the new count plus a small margin, and comment why.
4. Run CI locally:
   - `node portal/ui-eval/run.mjs` must exit 0.
   - The full unit suite on a fresh database, per rule 1.
   - The e2e flow: seed with `tests/e2e/seed.mjs`, start the portal dev server as the workflow does, then `node tests/e2e/flows.playwright.mjs`.
5. Commit and push to the same branch.

## Gate A (HUMAN): the deploy-preview database

Ask the human to do one of these in Netlify, on all three sites or once at team level:
- Set `DATABASE_URL` for the **Deploy previews** context to a Neon **branch** (recommended), or
- Turn deploy previews off until this merges.

Wait for an explicit "done" before Step 2. If previews still point at production, opening the PR runs this migration on production as soon as anyone loads a preview.

## Step 2: open the PR and watch CI (you)

1. Open the PR to `main`: `gh pr create --base main --head families/merge-and-activity`.
   - **Title:** something like "Families, applications and classroom".
   - **Body:** the QA summary table from `docs/releases/2026-11-classroom.md`, a link to that file, the list of tests already failing on main, and the PR attribution line.
2. Watch the checks: `gh pr checks <n> --watch`. Fix real failures on the branch and push. Never re-run hoping a failure goes away; read the log.
3. When it's green, tell the human: PR link, checks green, ready for release day.

## Gate B (HUMAN): release-day prerequisites

The human, in the Neon console:
- Creates the snapshot branch `pre-classroom-2026-11` from `main`.
- Notes the point-in-time restore window.

Then they run the backup on their machine:

```
DATABASE_URL="$(pbpaste)" node scripts/release/backup.mjs
```

It must end with `OK` and write to `~/TCA-backups/`. They copy those files to Google Drive.

Then the rehearsal, which needs Docker and touches only a local copy:

```
node scripts/release/rehearse.mjs ~/TCA-backups/<file>.dump --rollback main
```

It must end with **`Rehearsal passed.`**. If any check prints `FAIL`, **stop**. Read the failure, fix it on the branch, push, wait for green CI, and rehearse again. Don't merge on a failed rehearsal.

## Gate C (HUMAN): merge

Pick a quiet time (evening) and ask staff not to edit for 15 minutes. The human merges, or tells you to with `gh pr merge <n> --merge`. Don't squash; the history explains the migration.

## Step 3: watch the deploy (you)

1. Watch all three Netlify production deploys until they're Published. If one fails to build, tell the human right away; production keeps the previous deploy.
2. Open https://portal.trinityclassical.academy/health, then ask the human to sign in as an admin. That first request runs the migration.
3. The human runs the post-deploy check:
   `DATABASE_URL="$(pbpaste)" node scripts/release/verify.mjs ~/TCA-backups/<file>.counts.json`
   It must end with **`Live database checks passed.`** "Migration has not run yet" means no request has reached the database yet: load a page and run it again.

## Step 4: smoke test (you drive, the human confirms)

Use the human's admin session, or ask them to click through:
- **Emails:** Developer → Emails → Send me a test. It arrives, and **Sent** shows it as Sent. *Missing work*, *Grade below C-* and *Marked absent* show **Off**.
- **Overview** loads.
- **Families:** search, open a family, close it. The search is still there.
- **Applications:** Formaloo requests appear with sensible stages. **Don't** click stage buttons or Approve; those email real families.
- **Classes**, **Report cards** and **Messages** load.
- **A guardian's view** loads (the human can check their own family): home, students, documents, announcements.
- **Public site:** the tour booking page loads. The "Request an Interview" button opens **Formaloo** (`trinity-classicalalabama.formaloo.me/tqo8fo`).
- **Formaloo pull:** the human runs
  `curl -X POST -H "Authorization: Bearer <FORMALOO_WEBHOOK_TOKEN>" "https://portal.trinityclassical.academy/api/ingest/formaloo?dry=1"`
  It returns counts and writes nothing. Optionally, submit one test interview request in Formaloo and confirm it reaches Applications.

## Rollback (decide with the human)

- **The site errors and verify says the migration didn't run:** nothing changed. Netlify → each site → Deploys → previous production deploy → Publish.
- **The app misbehaves after the migration ran:** publish the previous deploys. The old code runs on the new database (rehearsed).
- **Data is wrong:**
  1. Publish the previous deploys.
  2. The human restores Neon from `pre-classroom-2026-11`, or to just before the migration. Last resort: `pg_restore` the dump into a new Neon branch.
  3. Re-pull Formaloo with `?mode=full`.
- **An email is going out that shouldn't:** Developer → Emails → that email → Turn off. Immediate, no deploy.

## Done means

- The PR is merged with green checks.
- All three sites are published.
- `verify.mjs` passed.
- The smoke test passed.
- You've sent the human a short report: what shipped, anything skipped and why, and the follow-ups below.

## Follow-ups after release (not part of shipping)

- Turn on the three automatic family alerts when the school is ready (Developer → Emails).
- Move interview requests off Formaloo: `INTERVIEW_URL` in `src/lib/links.ts`, plus `INTERVIEW_FORM=portal` on the portal site.
- The ClassReach migration, steps 1–6 in the release plan.
- The root SPF record doesn't list Resend. DKIM already passes, so it's optional hardening.
