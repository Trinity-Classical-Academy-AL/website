# Three sites, one database

Trinity Classical Academy runs as three Astro apps in this repo. Each one is its own Netlify site. They share one Postgres database. There is no separate API server. Flyer files stay in Netlify Blobs on the website site.

| App | Folder | Host | Netlify base directory |
| --- | --- | --- | --- |
| Public website | `/` (existing site `tcabham`) | `trinityclassical.academy` | repo root |
| Family portal | `portal/` | `portal.trinityclassical.academy` | `portal` |
| Staff admin | `admin/` | `admin.trinityclassical.academy` | `admin` |

Shared code is `packages/school` (`@tca/school`): schema, queries, passwords, sessions, Resend, and flyer storage.

## Portal interface

Fonts are self-hosted in `portal/public/assets/fonts` and declared once in `portal/public/css/fonts.css` with `font-display: optional`. Layouts preload those files and keep the font stylesheet across client navigations, so a route change does not load the faces again.

Interactive controls use [Ark UI](https://ark-ui.com) (`@ark-ui/react`): the account menu, mobile menu, dialogs, selects, password visibility, and in-page section tabs. Open and close states use Ark’s `data-state` presence so the motion is the same everywhere. Styling stays on the existing portal classes.

Radius tokens, in `portal/public/css/portal.css`:

| Token | Value | Use |
| --- | --- | --- |
| `--r-control` | 6px | Buttons or rows inside a menu, dropdown, popover, or dialog. Inputs stay 4px (`--r-sm`). |
| `--r-pill` | 999px | Standalone buttons, including the account menu trigger |

A Settings or Sign out row inside the account menu uses `--r-control`. A Save button sitting on the page uses `--r-pill`.

The public website still serves `/visit`, the interest block, and the announcement banner. Those read and write the database through the website's Netlify functions (`/api/banner`, `/api/tours`, `/api/tour-requests`, `/api/interest`). The first request copies any rows still sitting in the old Blobs (or local `.data/admissions`) store into Postgres, once.

## Page actions

Portal page mutations use `portal/src/lib/actions.ts`. Keep the page's role/resource gates before `runActions(Astro, handlers, options)`. The helper ignores non-POST requests, reads FormData once, checks the existing CSRF cookie, dispatches the `action` field, and returns either `{ redirect, status? }` or `{ error, fields, draft, status? }`. Unknown actions are inert unless the page explicitly supplies its legacy `fallback`. `draftFrom` retains display state on validation/CSRF failures; `actionFrom` handles Settings' duplicate resend action. CSRF expiry keeps “That request expired. Try again.” Pages retain their existing error rendering, HTTP status and redirect policy (including RSVP JSON/303 responses and Settings' error redirects).

School mutations share the `Result<T, E>` type in `packages/school/src/result.ts`; success data and error metadata keep their existing runtime shapes. `redirectOnSuccess` converts that result for either a save or delete handler. `fieldErrorMessage` centralizes field counts with explicit legacy copy variants. `toastFrom(url, map)` resolves existing query flags in map order without adding new notifications.

For deletion, open the existing confirmation dialog, submit a CSRF-protected POST with `action=delete`, and return the existing removal URL, usually `?removed=1`, through the same helper. Existing forms keep their legacy action names (`delete-doc`, `delete-announcement`, `rule-delete`, `remove-student`, `remove`, `cancel`) and their exact redirect/toast behavior; several have no removal toast or confirmation. This layer does not change hard deletes, soft cancellations, role removal, or inline notifications.

Enhanced forms use `submitAndRevalidate` in `interactions-core.ts`: submit once, parse/apply the server response, and give fresh HTML to ClientRouter. Following a success redirect performs the revalidation GET. Validation errors restore optimistic UI and merge field errors into the typed draft; uncertain POSTs are never replayed. The public RSVP page retains its scoped JSON client. Auth/session handlers remain separate.

Reads should not write application data. Schema readiness remains idempotent. The R1 audit found two behavior-sensitive exceptions, deferred until their replacement is specified: recurring-slot materialization from tour reads (`familyTourView`, `listAdminTours`, `listSeriesOccurrences` and their list/website wrappers), and legacy account repair (`getFamily`, `listSignInEmails`, `notificationChoices`, `adminLossOnRemove`). Removing these requires deciding how to populate occurrences and migrate legacy sign-in/notification rows. `ensureTourSlots` is already a no-op. The complete audit and deletion inconsistencies are recorded in the R1 lane summary.

## Scheduling and tours

`packages/school/src/scheduling/` owns series materialization, booking-window arithmetic, reservation locking/capacity and hold cancellation. `reserve(tx, { slotId, party, today, source })` runs inside the caller's transaction: it takes the slot advisory lock and row lock, checks capacity and writes the hold. Booking sources enforce publication, date and series-window eligibility, update the family's latest active slot hold, retain its status for the same slot and reset it to `new` when moving. Confirmation sources convert the specified open request to a confirmed hold; staff replies and accepted proposals retain their existing ability to confirm past, unpublished or out-of-window times. The tour request consumer still serializes creation of a requested time before reserving it. Tours retain their 1–6 head-count cleanup before calling the core.

`slotAvailability(sql, excludeFamilyId?)` is the single SQL capacity calculation used by reservations and occurrence reads. Active `slot` holds count by head count for people capacity, or by distinct family for families capacity. Family views exclude the current family's holds and expose only their own booking details; admin and website summaries count everyone. `cancelHolds` returns affected reservations without sending messages. Occurrence removal cancels all active attached holds, deletes the slot and preserves the existing six-field cancellation return shape; series deletion leaves past slots/holds intact. Generic scheduling skip/delete functions remain silent, while tour wrappers send the existing cancellation notices after the transaction.

`packages/school/src/tours/` contains slots, holds, requests, the family view, website summary, formatting/status definitions and cancellation notifications. `inquiries.ts` owns inquiries and preserves the existing staff-notification and opt-in auto-reply behavior. `campus.ts` owns the address used in booking messages. `TOUR_STATUSES` supplies page status values; Inquiries retains its existing four choices. `index.ts` re-exports all prior public names, and `prospect.ts` / the tour exports in `portal-admin.ts` remain compatibility facades. Consumers keep their existing `@tca/school` imports. Recurring read-time materialization remains the behavior-sensitive exception described above.

## Database

Neon Postgres. All three production sites use the same `DATABASE_URL`.

Tables: `families`, `email_tokens`, `settings` (banner JSON and flags), `tour_dates`, `tour_requests`, `interest_notes`, `tour_bookings`, `questions`, `events`, `rsvps`, `activity`.

The apps create missing tables on startup. A family is one login: name, email, phone, password hash. There is no child table.

Tour seats are website requests (one seat each, unless cancelled) plus portal bookings (head count). Website requests and interest notes are `new` or `contacted`.

Deploy previews must not use the production database. Create a Neon branch and set that branch's URL on the preview environment. A preview pointed at production can change the live banner.

### Provision Neon

1. Create a project at [neon.tech](https://neon.tech).
2. Copy the pooled connection string.
3. Put it in `DATABASE_URL` on all three Netlify sites (production).
4. Optional: `npm run` is not required. The first request applies `packages/school/src/schema.ts`.

## Netlify sites to create

Do not replace `tcabham`.

**Family portal**

1. Add a new site from `Trinity-Classical-Academy-AL/website`.
2. Base directory: `portal`.
3. The build command and publish directory are already in `portal/netlify.toml` (`npm install` from the repo root, publish `dist`).
4. Node 22.
5. Domain: `portal.trinityclassical.academy`.

**Staff admin**

1. Another new site from the same repo.
2. Base directory: `admin`.
3. Build settings come from `admin/netlify.toml`.
4. Domain: `admin.trinityclassical.academy`.
5. Set `TCA_ADMIN_TOKEN` here only. It is the one staff key. The cookie `tca_admin_session` is httpOnly, 14 days, and host-only (no `Domain` attribute), so it is not sent to the public site or the portal.

## DNS at GoDaddy

The domain uses GoDaddy nameservers `ns17.domaincontrol.com` and `ns18.domaincontrol.com`. Add records in GoDaddy DNS, not by changing nameservers.

1. In each new Netlify site, add the custom domain and copy the host Netlify gives you (a `*.netlify.app` name).
2. In GoDaddy DNS for `trinityclassical.academy`:
   - CNAME `portal` → the portal site's Netlify host
   - CNAME `admin` → the admin site's Netlify host
3. Leave the apex and `www` records that already point at `tcabham` alone.
4. Wait for Netlify to issue the certificates.

## Environment variables

| Name | Website | Portal | Admin | Notes |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | yes | yes | yes | Neon connection string. Same value in production. |
| `TCA_ADMIN_TOKEN` | | | yes | Long random staff key. |
| `FAMILY_SESSION_SECRET` | | yes | | Signs the family cookie. Required in production. |
| `RESEND_API_KEY` | yes | yes | | Verification, password reset, booking and RSVP confirmations, staff notices. |
| `EMAIL_FROM` | yes | yes | | Default `Trinity Classical Academy <noreply@trinityclassical.academy>`. The domain must be verified in Resend. |
| `STAFF_NOTIFY_EMAIL` | yes | yes | | Default `michelle.taylor@trinityclassical.academy`. Tour bookings, other-time requests, and inquiries. |
| `INQUIRY_AUTOREPLY` | | optional | | Set `off` to prevent automatic inquiry replies regardless of the admin setting. Absent still defaults to off until staff enable the setting. |
| `PORTAL_ORIGIN` | | yes | | Default `https://portal.trinityclassical.academy`. Used in email links. |
| `PUBLIC_SITE_URL` | | yes | | Default `https://trinityclassical.academy`. Links back to the main site. |
| `FLYER_SITE_ID` | | | yes | Website Netlify site id, so admin uploads land in the website blob store. |
| `FLYER_BLOB_TOKEN` | | | yes | A Netlify personal access token that can write that site's blobs. |
| `SCHOOL_NOTIFY_WEBHOOK_URL` | optional | optional | optional | Extra POST of the same staff notice. |
| `SCHOOL_NOTIFY_WEBHOOK_TOKEN` | optional | optional | optional | Bearer token for that webhook. |

If `RESEND_API_KEY` is missing, the account, booking, or note is still saved. The message is written to the function log instead of sent. In local dev the portal shows the confirmation link on screen.

## Local development

```sh
# Postgres, then:
export DATABASE_URL=postgres://USER:PASSWORD@127.0.0.1:5432/tca
export TCA_ADMIN_TOKEN=local-dev-token
export FAMILY_SESSION_SECRET=dev-family-secret
export ADMISSIONS_STORE=file
npm install
npm run dev                 # website, http://127.0.0.1:4321
npm run dev --workspace=admin    # http://127.0.0.1:4322
npm run dev --workspace=portal   # http://127.0.0.1:4323
```

## What this does not include

Applications are a disabled “later” item in the staff nav. Public interview requests at `/interview` save contact details and child answers in `inquiries.details` (jsonb), visible in Inquiries and Prospects. The page is built but not linked from the public site: website interview CTAs still point to the Formaloo form until the Formaloo workflow is mapped. No account is required.

Signed-out GETs to an open `/rsvp/:id` redirect with an absolute same-origin 303 to unified sign-on with a validated pending return. Sign-on, password, and sent pages show the event-title callout; unknown events stay 404, and closed events stay on the event page. All signed-in roles use the same `rsvps` record as the portal Events page, unique per event and family account, with a head count (1–20), note, and updated time. Existing RSVPs show a collapsed confirmation with a button to expand the editor; the page-scoped `data-enhance` / `data-optimistic="rsvp"` handler reuses shared busy/toast helpers, optimistically updates the summary, and restores saved values and reopens on failure. Without JavaScript the editor stays available and successful POSTs redirect back with 303. The sign-in email is read from the session. Prior anonymous responses stay in `event_guest_rsvps` as “guest (legacy)”; the current portal does not write new guest rows. Events admin and its CSV export include both sources and combined totals. Submissions on the public RSVP page send no email; existing Events confirmations and account cancellation notices remain in place.

Auth returns accept only exact `/rsvp/<uuid>` paths and the existing `tour` / `/tour` aliases. An hour-long httpOnly `tca_after_login` cookie survives password sign-in and setup, then is consumed once. New-account email verification tokens also store the validated return so opening the link in a fresh browser retains it. Google OAuth binds the return and optional email-linking id to a one-time, ten-minute httpOnly nonce cookie and matching OAuth state. Invalid return targets fall back to the account’s role home. Sign-out accepts a validated return only through a CSRF-protected POST.

The January 26, 2027 Information & Enrollment Night is seeded once during schema bootstrap (UUID `ec99c6a0-30da-4b66-8ccb-777c05360f4b`). The `seed:info-night-2027-01-26` setting prevents overwriting edits or recreating a deleted event. Future featured events drive `/api/banner` and the existing homepage banner/modal, including text-only events; past events expire at their end time, or three hours after their start.

Inquiries admin has a “Send an automatic reply to new inquiries” setting and exact read-only preview. The settings key `inquiry_autoreply_enabled` defaults to off. Only new `/interview` and `/interested` inquiries qualify; enabling the setting sends no historical replies. `INQUIRY_AUTOREPLY=off` always disables delivery. A successful reply records `autoreply_sent_at`; failed mail never removes the saved inquiry. Replies use the office notification email as Reply-To. The exported `inquiryAutoReply()` function and its snapshot tests hold the exact wording.
