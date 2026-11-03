# Deployment guide

Step-by-step for shipping the Trinity Classical Academy website to
production on Netlify. Ordered from "do this first" to "final cutover."

## Summary

- **Host**: Netlify (free tier)
- **Repo**: `github.com/bryantbrock/tca-landing`
- **Domain**: `trinityclassical.academy`
- **Analytics**: Cloudflare Web Analytics (token needed — see step 5)
- **Form backend**: Netlify Forms (auto-wired via `data-netlify` + hidden
  `form-name` in `src/pages/contact.astro`)
- **SSL**: Let's Encrypt, auto-provisioned by Netlify after DNS resolves
- **Build command**: `npm run build` (already in `netlify.toml`)
- **Publish directory**: `dist/`

## Before you start

You'll need:
- [ ] A GitHub account with push access to `bryantbrock/tca-landing`
- [ ] A Netlify account (free, sign in with GitHub for zero friction)
- [ ] Access to whatever manages DNS for `trinityclassical.academy` (likely
      Squarespace — confirm with `dig NS trinityclassical.academy +short`)
- [ ] A Cloudflare account (free) — just to get a Web Analytics token.
      You do NOT need to move DNS to Cloudflare unless you want to.

## Step 1 — Push committed work to GitHub

The MVP build is already broken into 4 topical commits on `main`:

```
docs: add project documentation and archive dev-time scripts
feat: deployment infrastructure (Netlify config + sitemap integration)
feat: build out components, content pages, and design system
chore: add site assets (video, favicons, fonts, images, robots.txt)
```

Verify the working tree is clean and push:

```bash
git status                # should report "nothing to commit, working tree clean"
git log --oneline -6      # confirm the 4 commits stack on top of "feat: more scaffolding"
git push origin main
```

## Step 2 — Deploy to Netlify (preview URL first)

1. Go to **https://app.netlify.com** and sign in with GitHub.
2. Click **Add new site → Import an existing project**.
3. Choose **GitHub**, grant Netlify access to the `bryantbrock/tca-landing`
   repo.
4. Netlify auto-detects Astro. The build command and publish directory
   are already locked in via `netlify.toml` — just accept the defaults.
5. Click **Deploy site**. First build takes ~1 minute.
6. Netlify assigns a free `*.netlify.app` subdomain (e.g.
   `elegant-curie-12345.netlify.app`). You can rename it under
   **Site settings → General → Site details**.
7. Open the preview URL — the whole site should work. Forms won't
   *visibly* do anything yet until step 4.

## Step 3 — Enable and verify Netlify Forms

1. In Netlify, go to **Site settings → Forms → Form detection → Enable**
   (may already be on by default).
2. Re-trigger a build (**Deploys → Trigger deploy → Clear cache and
   deploy site**) so Netlify re-scans the HTML for form tags.
3. Open the preview URL's `/contact` page and submit a test message.
4. In Netlify, go to **Forms → contact** — you should see your test
   submission appear.
5. Under **Settings & usage → Form notifications**, add an email
   notification so submissions also email
   `info@trinityclassical.academy` when they arrive.
6. (Optional) Under **Form spam filters**, enable **Akismet** spam
   filtering — free add-on, uses the built-in honeypot already wired
   in the form (`netlify-honeypot="bot-field"`).

## Step 4 — Wire up Cloudflare Web Analytics

1. Go to **https://dash.cloudflare.com/?to=/:account/web-analytics**.
2. Click **Add a site**. Enter `trinityclassical.academy` (or the Netlify
   preview URL if you want to test first). Choose **Manual setup** (not
   "Automatic" — that's for Cloudflare-proxied sites, which we're not).
3. Copy the `<script>` block Cloudflare gives you — it contains a token
   like `data-cf-beacon='{"token": "abc123def456…"}'`.
4. Copy that token and replace `PLACEHOLDER_CF_WEB_ANALYTICS_TOKEN` in
   `src/layouts/Layout.astro` (find the comment
   "Cloudflare Web Analytics" — the token is on the next line).
5. Commit and push. Netlify will auto-deploy.
6. Within ~5 minutes of the deploy, visit the live site a few times.
   Cloudflare's dashboard should start showing page views.

## Step 5 — QA the preview URL

Before touching DNS, test the Netlify preview URL as if it were production:

### Critical paths
- [ ] Home page loads without errors, video plays
- [ ] Every nav link works (`/our-vision`, `/how-it-works`, `/people`,
      `/admissions`, `/contact`, `/faq`, `/careers`, `/resources`)
- [ ] All "Request an Interview" buttons open the Formaloo URL in a
      new tab
- [ ] Contact form submits a test message and shows the inline success
      state
- [ ] 404 page renders for a random invalid route (e.g. `/asdfasdf`)
- [ ] Images load (emblem in header, video poster, program cards,
      Creation of Adam)
- [ ] Fonts render without a visible flash on hard refresh

### Responsive
- [ ] Mobile menu disclosure opens and closes
- [ ] Nav collapses to compact horizontal on scroll at lg+
- [ ] All pages look OK at 375px, 768px, 1024px, 1440px

### SEO sanity check
- [ ] `/sitemap-index.xml` loads
- [ ] `/robots.txt` loads
- [ ] View source on home page — confirm title, meta description,
      OG tags, structured data JSON-LD, Cloudflare beacon script

## Step 6 — DNS cutover

This is the point of no return. Squarespace keeps serving
`trinityclassical.academy` until DNS is updated.

### 6a. Figure out where DNS is managed

```bash
dig NS trinityclassical.academy +short
```

Probable answers:
- `ns-cloud-XX.googledomains.com` → Google Domains or Squarespace (Google
  is Squarespace's DNS provider for domains registered through them)
- `ns1.squarespacedns.com` → Squarespace
- `walter.ns.cloudflare.com` → Cloudflare
- `ns1.p01.dynect.net` → Dyn (uncommon)

### 6b. Add custom domain in Netlify

1. In Netlify: **Site settings → Domain management → Add a custom
   domain**.
2. Enter `trinityclassical.academy` and click **Verify**.
3. Also add `www.trinityclassical.academy` as an alias (Netlify will
   prompt you).
4. Netlify shows you either an **ALIAS/ANAME** target or a pair of
   **A records**. Copy both values.

### 6c. Update DNS records

In Squarespace (or wherever DNS is managed), update:

- **Apex/root `@` record** → ALIAS (preferred) or A records pointing
  at Netlify's load balancer. If your DNS provider doesn't support
  ALIAS/ANAME at the apex, use the A records Netlify gives you.
- **`www` CNAME record** → `YOURSITE.netlify.app`

**Leave these records ALONE:**
- All **MX** records (email delivery)
- **SPF** / **DKIM** / **DMARC** `TXT` records (email authentication)
- Any records related to Google Workspace (`mail`, `calendar`)

Changing A/CNAME records doesn't touch email.

### 6d. Wait and verify

- DNS propagation: usually <15 minutes, up to 48 hours.
- Check with `dig A trinityclassical.academy +short` — you should see
  Netlify's IPs.
- Once Netlify detects the domain is resolving, it will auto-provision
  a free Let's Encrypt SSL certificate. Wait for the green checkmark
  in the Netlify dashboard.
- Visit `https://trinityclassical.academy` — you should see the new
  site with a valid HTTPS lock.
- Test email by sending a message to `info@trinityclassical.academy`
  from a personal email and confirming it arrives as usual.

### 6e. Take Squarespace offline

Options:
- **Soft**: set the Squarespace site to "Private" / "Password-protected"
  so only you can access it. Safe if you want a rollback option for a
  week or two.
- **Hard**: delete the Squarespace site. Only do this once you're
  confident the new site is working.

## Step 7 — Post-deploy

- [ ] Submit `https://trinityclassical.academy/sitemap-index.xml` to
      Google Search Console
- [ ] Test Lighthouse on the live site — target ≥90 on all 4 metrics
- [ ] Monitor Cloudflare Web Analytics for a few days to confirm
      traffic is flowing
- [ ] Monitor Netlify Forms submissions for the first week to make
      sure the contact form is being used
- [ ] Update `docs/roadmap.md` to mark MVP phase complete

## Staff token, portal, and database

The website, the family portal (`portal/`), and the staff admin (`admin/`) share one Neon database. Setup, GoDaddy CNAMEs, and every environment variable are in `docs/architecture.md`.

`TCA_ADMIN_TOKEN` is set on the **admin** Netlify site, not on `tcabham`. `DATABASE_URL` is set on all three. Do not commit the values.

In Netlify: **Site configuration → Environment variables**. The full matrix is in `docs/architecture.md`.

| Name | Where | Value |
| --- | --- | --- |
| `DATABASE_URL` | Website, portal, and admin. Use a Neon branch for deploy previews. | Neon connection string. |
| `TCA_ADMIN_TOKEN` | Admin site only. | A long random secret. |
| `FAMILY_SESSION_SECRET` | Portal site. Required in production. | A long random secret. |
| `RESEND_API_KEY` | Website and portal. | Resend API key. Mail is logged until this is set. |
| `EMAIL_FROM` | Website and portal. | Verified sender, for example `Trinity Classical Academy <noreply@trinityclassical.academy>`. |
| `STAFF_NOTIFY_EMAIL` | Website and portal. | Inbox for new requests, bookings, questions, and RSVPs. |
| `FLYER_SITE_ID` / `FLYER_BLOB_TOKEN` | Admin site. | So flyer uploads land in the website's blob store. |

`SCHOOL_NOTIFY_WEBHOOK_URL` is still an optional extra POST. Resend is the mail path. See `packages/school/src/email.ts`.

Tour time, capacity, and the on-screen confirmation live in `src/lib/admissions/defaults.ts`.

## Known TODOs post-launch

These can wait until after deployment:

- [ ] Replace `public/og-image.png` with a branded card (current one
      is the old dark blue TCA placeholder from the Astro scaffold)
- [ ] Per-page OG images
- [x] ~~Add the Formaloo URL to a shared constant.~~ **DONE.** Lives in
      `src/lib/links.ts` as `INTERVIEW_URL`. Same file also exports
      `GIVE_URL` for the GivingFuel donation page.
- [ ] Build a Contact form thank-you page with the inline UX handled
      on the current contact page
- [ ] Add photos + bios to the People page
- [ ] Get the actual Issuu embed URLs for Tuition & Fee Policy and
      Uniform Policy (currently the Resources page links to the old
      Squarespace versions)
- [ ] 301 redirects from old URL structure to new
      (`/our-philosophy` → `/our-vision`,
      `/enrollment-process` → `/admissions`,
      `/learning-cohorts` → `/how-it-works`, etc.)
