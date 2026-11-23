# Release: families, applications and classroom (branch `families/merge-and-activity`)

About 90 commits on top of production (`main` at 87d06ef). All three Netlify sites (portal, admin, public site) deploy from `main` and share one Neon database, so merging ships all three together.

## QA summary

| Area | Status |
| --- | --- |
| Data loss | Only unbooked open-house, info-night and interview tour times are deleted. Every other row is kept. Rehearsed on a copy built by production's code, including rolling back and forward again. |
| Emails | Every one of the 41 emails is listed below with what sends it. Nothing is scheduled. Every send is logged, a duplicate within two minutes is skipped, and three automatic family alerts start off. |
| Asking before emailing families | Every staff button that emails a family or prospective family asks first and says who gets the email. |
| Formaloo | Unchanged and still the front door. The website's interview buttons point to Formaloo again; this release had switched them to the portal. |
| ClassReach | Unchanged. The NucBox pull still only writes staging tables. Migration is a plan for later (below), not part of this release. |
| Tests | 568 unit tests on a fresh database. The ones this branch broke are fixed. Five failures were already failing on `main`: full tour date, forms jsonb, account RSVP, the legacy-repair query count, and info-night, which hangs. |

## What happens to the data

The first request to any site after the deploy runs the schema in **one transaction**. If any statement fails, nothing changes, the marker stays old and the site errors. Nothing is left half-migrated.

Added: 22 tables (children, enrollments, applications, family_people, family_activity, family_join_requests, school_terms, classes, class_students, courses, attendance, assignments, scores, grade_alerts, report_cards, message_threads, messages, message_reads, chat_groups, chat_group_members, announcement_reads, email_log) and new columns. Nothing is dropped or renamed. `students` and `prospect_children` stay and are copied into `children`.

One-time data changes. Each runs once, guarded by a `settings` key:

| Key | Change | Reversible without a backup? |
| --- | --- | --- |
| `children_copy_v1` | Copies students and prospective children into `children` (same ids). | Yes, the originals stay. |
| `enrollments_backfill_v1` | Creates this year's enrollment for each current student. | Yes, additive. |
| `applications_per_family_v1`, `applications_one_per_family_v1` | Merge sibling and duplicate applications into one per family. Production has no `applications` table yet (this release creates it), so there is nothing to merge. The table fills from interview requests afterwards. | Yes. |
| `person_access_v1` | Copies each household's admin/staff role onto its primary sign-in email. `families.roles` is left alone. | Yes. |
| `tours_campus_only_v1` | **Deletes** open-house, info-night and interview tour times that nobody booked, and their schedules. | **No** (only unbooked times). |
| `events_audience_v1`, `notification_routes_defaults_v1` | Fill new columns from existing values. | Yes. |

The only rows this release deletes are tour times nobody booked. Rehearsed on a copy built by production's code (`main`):

- Every table kept every row except `tour_slots` and `schedule_series`.
- Every admin kept admin.
- Every family and child carried over.
- `main`'s code still starts on the migrated database, and this release starts again after that.

## Emails

### Delivery

- **Sender:** Resend, from `noreply@trinityclassical.academy`.
- **DKIM:** `resend._domainkey` is published, and DMARC is relaxed (`adkim=r`), so mail passes DMARC through DKIM.
- **SPF:** the root SPF record doesn't list Resend. Resend's return-path subdomain (`send.`) has its own SPF, so this isn't blocking.
- **Check after deploy:** Developer → Emails → any email → **Send me a test**. Then Developer → Emails → **Sent** should show it as Sent.

### Guards in this release

- **Log:** every attempt is recorded (`email_log`): template, recipient, subject, and whether it went, or why not (turned off, duplicate, no email service, rejected). Developer → Emails → **Sent** shows the last 200.
- **Duplicate guard:** the same email to the same people within two minutes is skipped, so a double-click or retry can't send twice.
- **On/off per email** (Developer → Emails → Turn off / Turn on). An email that's off is skipped and logged.
- **Off by default:** *Missing work*, *Grade below C-* and *Marked absent*. They fire just from a teacher saving the gradebook or attendance, with no confirmation, so they wait until you choose to turn them on. When they're on, the gradebook and attendance pages tell teachers that saving emails families.
- **Nothing is scheduled:** there are no timed jobs and no reminder emails on a clock. Every email below happens because someone did something.

### Every email, and what sends it

Families and prospective families:

| Email | Sent when | Asks first? |
| --- | --- | --- |
| Account setup, confirm email, sign-in code, password reset, password changed | The person does it themselves (signs up, adds an email, resets) | Their own action |
| Guardian added | A guardian adds another adult to their family | Their own action |
| Thanks for your interest (auto-reply) | A request comes in through the **portal's** interest or interview form, if the auto-reply is on (Admin → Inquiries). Formaloo requests never get it. | Setting |
| Tour booked, tour request received, tour cancelled | The family books, asks for another time, or cancels | Their own action |
| Tour proposed / confirmed | Staff press **Send** on a tour request | The sheet says it emails them |
| Tour declined | Staff press **Decline** | Yes |
| Tour cancelled by the school | Staff delete or skip a tour time someone booked | Yes |
| RSVP confirmation | The family RSVPs | Their own action |
| Event cancelled | Staff delete an event with RSVPs | Yes |
| Interview invitation | Staff move an application to Interview (button, Stage dropdown, or dragging on the board) | Yes. Cancel puts it back. |
| Approved, full application link | Staff approve an application | Yes |
| Not approved | Staff mark an application not approved | Yes |
| Application received | The family submits the full application | Their own action |
| Enrollment agreement / waitlisted | The full application is marked received (enrollments open) | Yes |
| Enrolled / waitlisted (per child) | Staff change a child's enrollment | Yes |
| Approved and agreement catch-up | Staff **publish** an Application or Enrollment agreement form. It shows how many families get it. **Formaloo applicants are never emailed by this.** | Yes, with the count |
| Announcement | Staff publish with "Also email it" ticked | Yes |
| New document | Staff publish with "Email guardians" ticked | Yes |
| Form reminder | Staff press Remind on a form | Yes |
| Re-enrollment open / reminder | Staff open re-enrollment or press Remind | Yes, with the count |
| Report cards released / updated | Staff press Release (only families whose cards changed) | Yes |
| Message from the school, class note, direct message, group message | Someone presses Send in Messages | The Send box says they also get it by email |
| Missing work, grade below C-, marked absent | A teacher saves the gradebook or attendance | **Off by default** |

Staff: new requests, bookings, RSVPs and questions go to `STAFF_NOTIFY_EMAIL` and every admin. Admins added by person on Staff & access now get them too; before, only household admins did. Teachers get family messages and absence reports. "Access added" goes to the person being added.

## Formaloo, until you move over

- **Front door:** every "Request an Interview" button on the website goes to the Formaloo form, as it does today. This release had switched them to the portal's own form, which would have stopped new requests reaching Formaloo. That's reverted. The portal's own prospect pages follow the same switch.
- **Intake (unchanged):** Formaloo calls `POST /api/ingest/formaloo` (token `FORMALOO_WEBHOOK_TOKEN`), and the portal pulls rows with `FORMALOO_API_KEY` / `FORMALOO_API_SECRET`. Writes happen only where `INCOMING_PRODUCTION=yes`. Intake sends no email.
- **New in this release:** the portal's Applications page builds one application per family from those requests. It maps Formaloo's Status column onto stages and keeps staff changes. Formaloo stays the record: changing a status in Formaloo updates the portal until staff change that application in the portal.
- **Emails:** publishing a portal application form never emails Formaloo applicants. A stage change made in the portal does email the family (after asking), so during the transition keep moving Formaloo families along in Formaloo.
- **Moving over later:** change `INTERVIEW_URL` in `src/lib/links.ts` to `https://portal.trinityclassical.academy/interview`, and set `INTERVIEW_FORM=portal` on the portal site. Keep the Formaloo webhook on until the last Formaloo application is finished. Formaloo still holds every submission (`?mode=full` pulls them all again).

## ClassReach

**This release:** nothing changes for ClassReach.
- The NucBox script pulls the ClassReach calendar and directory hourly into staging tables (`classreach_*`). Families never see them, and ClassReach is only ever read.
- The script does `git pull` of `main`, so it runs this release's code after merge. Its files and tables are unchanged.
- ClassReach stays the record for enrolled students, grades and report cards until the moves below.

**Migration plan** (separate releases; each step only adds to the portal and never writes to ClassReach):
1. **Directory match.** An admin screen pairs ClassReach families, guardians and students with portal families by email. It shows a dry-run summary (matched, new, conflicts) and imports only what the admin approves. Imported children carry their ClassReach id, so re-running is safe. No email goes out.
2. **Classes.** Admin → Classes → set up this year from enrollment grades. Assign teachers.
3. **History.** Export past report-card grades from ClassReach as CSV and bring them in with Admin → Classes → Import grades. Transcripts then cover past years.
4. **Invitations.** One deliberate batch of account invitations to enrolled families, with a confirmation that shows the count.
5. **Run in parallel for a quarter.** Teachers keep grades in the portal; ClassReach stays read-only as the reference.
6. **Switch at a quarter boundary.** Stop the NucBox pull and keep the staging tables as an archive.

## Layers of protection

1. **Neon branch snapshot**, taken right before merging (Neon console → Branches → Create branch from `main`, named `pre-classroom-2026-11`). It's instant and complete. To restore, point `DATABASE_URL` at it or reset `main` from it. Keep it at least 30 days.
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
3. Backup (layer 3). Copy the production connection string from Neon, then run
   `DATABASE_URL="$(pbpaste)" node scripts/release/backup.mjs`. Copy the files in `~/TCA-backups` to Google Drive.
4. Rehearse on that dump (layer 4). It must print `Rehearsal passed.`:
   `node scripts/release/rehearse.mjs ~/TCA-backups/<file>.dump --rollback main`
5. Merge the PR. Wait for all three Netlify production deploys to be Published.
6. Open https://portal.trinityclassical.academy/health, then sign in as an admin. That first request runs the migration.
7. Verify against the backup. It must print `Live database checks passed.`:
   `DATABASE_URL="$(pbpaste)" node scripts/release/verify.mjs ~/TCA-backups/<file>.counts.json`
8. Emails: Developer → Emails → Send me a test, then check **Sent**. Confirm *Missing work*, *Grade below C-* and *Marked absent* show **Off**.
9. Smoke test:
   - Overview.
   - Families: search, then open a family.
   - Applications: Formaloo requests appear with the right stages.
   - Classes.
   - A family's home and documents.
   - The public site's tour booking.
   - The public site's interview button opens Formaloo.
10. Formaloo: run `curl -X POST -H "Authorization: Bearer <FORMALOO_WEBHOOK_TOKEN>" "https://portal.trinityclassical.academy/api/ingest/formaloo?dry=1"`. It returns row counts (a dry run that writes nothing). Then submit one test request in Formaloo and watch it reach Applications.

## Rolling back

- **The site errors and verify says the migration has not run.** The transaction failed and nothing changed. Publish the previous deploy on each site (Netlify → Deploys → previous production deploy → Publish).
- **The migration ran, but something is wrong with the app.** Publish the previous deploys. `main`'s code starts on the migrated database (rehearsed). Anything written in the new tables waits there for the fix.
- **Data is wrong.**
  1. Publish the previous deploys.
  2. Restore the database: reset Neon `main` from the snapshot branch, or restore to a moment before step 6.
  3. As a last resort, `pg_restore` the dump into a new Neon branch.
  4. Re-pull Formaloo with `?mode=full` for any requests that arrived in between.
- **An email is going out that shouldn't.** Developer → Emails → that email → Turn off. It stops at once, no deploy needed.
