# Release: families, applications and classroom (branch `families/merge-and-activity`)

About 80 commits on top of production (`main` at 87d06ef). All three Netlify sites (portal, admin, public site) deploy from `main` and share one Neon database, so merging ships all three together.

## What happens to the data

The first request to any site after the deploy runs the schema in **one transaction**. If any statement fails, nothing changes, the marker stays old and the site errors. Nothing is left half-migrated.

Added: 18 tables (children, enrollments, applications, family_people, family_activity, family_join_requests, school_terms, classes, class_students, courses, attendance, assignments, scores, grade_alerts, report_cards, message_threads, messages, message_reads) and new columns. Nothing is dropped or renamed. `students` and `prospect_children` stay and are copied into `children`.

One-time data changes. Each runs once, guarded by a `settings` key:

| Key | Change | Reversible without a backup? |
| --- | --- | --- |
| `children_copy_v1` | Copies students and prospective children into `children` (same ids). | Yes, the originals stay. |
| `enrollments_backfill_v1` | Creates this year's enrollment for each current student. | Yes, additive. |
| `applications_per_family_v1`, `applications_one_per_family_v1` | Merge sibling and duplicate applications into one per family. Production has no `applications` table yet (this release creates it), so there is nothing to merge; the table fills from interview requests afterwards. | Yes. |
| `person_access_v1` | Copies each household's admin/staff role onto its primary sign-in email. `families.roles` is left alone. | Yes. |
| `tours_campus_only_v1` | **Deletes** open-house, info-night and interview tour times that nobody booked, and their schedules. | **No** (only unbooked times). |
| `events_audience_v1`, `notification_routes_defaults_v1` | Fill new columns from existing values. | Yes. |

So the only rows this release deletes are tour times nobody booked. Rehearsed on a copy built by production's code (`main`): every table kept every row except `tour_slots` and `schedule_series`, every admin kept admin, every family and child carried over, `main`'s code still starts on the migrated database, and this release starts again after that.

## Formaloo

Unchanged path: Formaloo calls `POST /api/ingest/formaloo` (token in `FORMALOO_WEBHOOK_TOKEN`), and the portal pulls rows with `FORMALOO_API_KEY` / `FORMALOO_API_SECRET`. Writes happen only where `INCOMING_PRODUCTION=yes` (production context). New in this release: the Applications page builds one application per family from those interview requests. It maps Formaloo's Status column onto stages and keeps staff changes.

Formaloo still holds every submission, so interview requests can always be pulled again in full (`?mode=full`).

## Layers of protection

1. **Neon branch snapshot**, taken right before merging (Neon console → Branches → Create branch from `main`, named `pre-classroom-2026-11`). Instant and complete. Restoring means pointing `DATABASE_URL` at it or resetting `main` from it. Keep it at least 30 days.
2. **Neon point-in-time restore** for anything written after the snapshot. Check the restore window on the project's plan (Settings → Storage / History retention) before release day.
3. **A pg_dump file off Neon entirely**: `scripts/release/backup.mjs`. It writes a `.dump`, the row counts and a SHA-256, then checks the dump lists every table. Copy it to Google Drive as well as this laptop.
4. **A rehearsal on that dump**: `scripts/release/rehearse.mjs <dump> --rollback main`. It runs this exact migration on a throwaway copy, checks nothing was lost and tests rolling back. Production is never touched.
5. **Formaloo** itself, for interview requests.

## Before opening the pull request

Opening a PR builds **deploy previews** of all three sites. If previews use the production `DATABASE_URL`, the first visit to a preview runs this migration on production before review. Pick one:

- **Recommended:** in Netlify, set `DATABASE_URL` for the *Deploy previews* context to a Neon branch (on each of the three sites, or once at team level). This is what docs/deployment.md already intends.
- Or turn off deploy previews for the three sites until this merges.

## Release day

1. Pick a quiet time (evening). Tell staff not to edit in the portal for 15 minutes.
2. Neon: create the snapshot branch (layer 1) and confirm the PITR window (layer 2).
3. Backup (layer 3). Copy the production connection string from Neon, then:
   `DATABASE_URL="$(pbpaste)" node scripts/release/backup.mjs` and copy the files in `~/TCA-backups` to Google Drive.
4. Rehearse on that dump (layer 4). It must print `Rehearsal passed.`:
   `node scripts/release/rehearse.mjs ~/TCA-backups/<file>.dump --rollback main`
5. Merge the PR. Wait for all three Netlify production deploys to be Published.
6. Open https://portal.trinityclassical.academy/health, then sign in as an admin. That first request runs the migration.
7. Verify against the backup. It must print `Live database checks passed.`:
   `DATABASE_URL="$(pbpaste)" node scripts/release/verify.mjs ~/TCA-backups/<file>.counts.json`
8. Smoke test: Overview, Families (search, open a family), Applications (Formaloo requests appear with the right stages), Classes, a family's home and documents, and the public site's tour booking.
9. Formaloo: `curl -X POST -H "Authorization: Bearer <FORMALOO_WEBHOOK_TOKEN>" "https://portal.trinityclassical.academy/api/ingest/formaloo?dry=1"` returns row counts (dry run, writes nothing). Then submit one test interview request and watch it reach Applications.

## Rolling back

- **The site errors and verify says the migration has not run.** The transaction failed and nothing changed. Publish the previous deploy on each site (Netlify → Deploys → previous production deploy → Publish).
- **The migration ran, but something is wrong with the app.** Publish the previous deploys. `main`'s code starts on the migrated database (rehearsed). Anything written in the new tables waits there for the fix.
- **Data is wrong.** Publish the previous deploys. Then restore the database: reset Neon `main` from the snapshot branch, or restore to a moment before step 6. As a last resort, `pg_restore` the dump into a new Neon branch. Re-pull Formaloo with `?mode=full` for any requests that arrived in between.
