# Three sites, one database

Trinity Classical Academy runs as three Astro apps in this repo. Each one is its own Netlify site. They share one Postgres database. There is no separate API server. Flyer files stay in Netlify Blobs on the website site.

| App | Folder | Host | Netlify base directory |
| --- | --- | --- | --- |
| Public website | `/` (existing site `tcabham`) | `trinityclassical.academy` | repo root |
| Family portal | `portal/` | `portal.trinityclassical.academy` | `portal` |
| Staff admin | `admin/` | `admin.trinityclassical.academy` | `admin` |

Shared code is `packages/school` (`@tca/school`): schema, queries, passwords, sessions, Resend, and flyer storage.

The public website still serves `/visit`, the interest block, and the announcement banner. Those read and write the database through the website's Netlify functions (`/api/banner`, `/api/tours`, `/api/tour-requests`, `/api/interest`). The first request copies any rows still sitting in the old Blobs (or local `.data/admissions`) store into Postgres, once.

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
| `STAFF_NOTIFY_EMAIL` | yes | yes | | Default `info@trinityclassical.academy`. |
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

Applications are a disabled “later” item in the staff nav. The portal does not collect children, onboarding, or a checklist. Apply is a link to the existing Formaloo form.
