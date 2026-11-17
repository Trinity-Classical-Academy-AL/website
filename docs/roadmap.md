# Roadmap

The master task list for the Trinity Classical Academy website rebuild.
Organized by phase. Check items off as they ship. Add new items when you
discover them, and move them to the right phase.

> **Priority legend**: 🟢 next up · 🟡 soon · ⚪ later / nice-to-have

## Phase 1 — Landing page MVP (DONE ✓)

- [x] Port the Figma landing page pixel-perfect (hero, mission band, core
  beliefs, programs, join mission, footer)
- [x] Component extraction into `src/components/`
- [x] Sticky nav with mobile disclosure + desktop compact-on-scroll
- [x] Video header band replacing the Getty stock photo
- [x] Favicon (circular white bg + real emblem)
- [x] Vertical column-grid dividers running the full page
- [x] Contact page (`/contact`) with native form backup
- [x] Wire every `Request an Interview` CTA to the Formaloo link

## Phase 2 — Nav + information architecture (DONE ✓)

- [x] New flat 5-item nav: Our Vision / How It Works / People / Admissions / Give
- [x] Update `navItems` in `Header.astro` and `Footer.astro`
- [x] Swap anchor links (`#our-vision`) for real routes (`/our-vision`)
- [x] Update Hero "Learn More" → `/our-vision`
- [x] Update HowItWorks "Learn More" → `/how-it-works`

## Phase 3 — Core content pages (DONE ✓)

All pages built using existing-site content pulled via WebFetch, rendered
in the editorial design language established on `/contact`.

- [x] **`/our-vision`** — 9 subject sections (Humanities, Math, Bible,
      Science, History, Literature, Language, Art, Music) + Statement on
      Artistic Discernment
- [x] **`/how-it-works`** — The Cohort, Learning Levels, The Week,
      Integrated Learning
- [x] **`/people`** — 6 Board of Directors cards with placeholder portraits;
      photos and bios coming post-launch
- [x] **`/admissions`** — three-step enrollment process (Request Interview →
      Admissions Interview → Invitation to Apply)
- [x] **`/faq`** — 6 common questions as native `<details>` accordion
- [x] **`/careers`** — Join Our Faculty with requirements + application process
- [x] **`/resources`** — landing page linking to tuition/uniform (external,
      interim) + internal FAQ and careers routes
- [x] Updated 404 page with editorial design

## Phase 3.5 — Deployment infrastructure (DONE ✓)

All the plumbing needed to ship to a production host.

- [x] `@astrojs/sitemap` installed; emits `sitemap-index.xml` + `sitemap-0.xml`
- [x] `public/robots.txt` pointing at the sitemap
- [x] `site` URL set in `astro.config.mjs` to `https://trinityclassical.academy`
- [x] schema.org `EducationalOrganization` JSON-LD in Layout head
- [x] Cloudflare Web Analytics script in Layout head (token placeholder —
      fill in post-deploy)
- [x] Contact form wired to Netlify Forms (`data-netlify="true"`, hidden
      `form-name`, `netlify-honeypot="bot-field"`, AJAX submit with inline
      success/error states)
- [x] Styled 404 page matching the site design
- [x] Font flash fixed via `<link rel="preload">` for critical fonts
- [x] Removed unused `@fontsource/inter`
- [x] Archived 8 dev-time scripts to `scripts/.archive/`
- [x] `netlify.toml` with build config, caching headers, and security headers

## Phase 4 — Deploy & cutover 🟢 (waiting on owner actions)

See `docs/deployment.md` for the full step-by-step guide. Owner steps:

- [ ] **Commit & push** all current changes to GitHub
- [ ] **Create Netlify account** (or sign in), connect the GitHub repo
- [ ] **Deploy to the Netlify preview URL** and test forms + pages there
- [ ] **Grab Cloudflare Web Analytics token** from
      `dash.cloudflare.com/web-analytics`, replace the placeholder in
      `src/layouts/Layout.astro`
- [ ] **Check DNS** with `dig NS trinityclassical.academy +short` to
      confirm it's on Squarespace
- [ ] **DNS cutover**: update apex A records and www CNAME to Netlify;
      leave MX records untouched so email keeps working
- [ ] **Wait for DNS + SSL provisioning** (~15 min typical)
- [ ] **Verify email still delivers** after cutover
- [ ] **Take Squarespace offline** (soft first — set to Private — then
      hard once confident)
- [ ] **Submit sitemap** to Google Search Console

## Phase 5 — Resources & policies (needs owner input) 🟡

Lower priority because the content is primarily for families who already
applied. Embeds existing Issuu flipbooks for now; can replace with native
rendering later.

- [ ] **Resources index** (`/resources`) — landing page linking to tuition,
  uniforms, FAQ, calendar, etc.
- [ ] **Tuition & Fee Policy** (`/resources/tuition`) — Issuu flipbook embed
- [ ] **Uniform Policy** (`/resources/uniform`) — Issuu flipbook embed
- [ ] **FAQ page** (`/faq` or `/resources/faq`) — expandable Q&A, pulled
  from existing site
- [ ] **Calendar** (`/calendar` or `/resources/calendar`) — Google Calendar
  embed OR static ICS import. Defer until school year ramps up.

## Phase 5 — Admissions + growth 🟡

- [ ] **Fix the Formaloo interview link** — owner-side task. The URL
  `trinity-classicalalabama.formaloo.me/tqo8fo` currently 404s. Log into
  Formaloo admin and republish the form, then update the URL here if the
  slug changed.
- [ ] **Join Our Faculty page** (`/careers` or `/join-our-faculty`) — list
  open positions, culture pitch, application CTA
- [ ] **Contact form wiring** — replace `mailto:` with Formspree (or Netlify
  Forms if we deploy on Netlify). See `pages/admissions.md` for evaluation.
- [ ] **Email list signup** — either a small form in the footer or a modal
  after 30s on page. Use the same service as the contact form.

## Phase 6 — Events + ongoing ⚪

- [ ] **Upcoming Events page** — integrate with the calendar solution
- [ ] **News / Blog** — if the school wants to publish articles. Astro
  content collections are perfect for this. Owner hasn't asked yet.
- [ ] **Newsletter archive** — if emails get sent via Mailchimp/Beehiiv

## Phase 7 — Analytics, SEO, polish ⚪

- [ ] **Set up analytics** — Google Analytics, Plausible, or Fathom (owner
  pick)
- [ ] **Open Graph images for every page** — per-page og-image with the
  page title + emblem
- [ ] **Sitemap generation** (`@astrojs/sitemap`)
- [ ] **robots.txt** + a basic crawler-friendly baseline
- [ ] **Structured data** — School schema.org markup
- [ ] **Lighthouse pass** — check performance, a11y, SEO, best practices

## Active issues / tech debt

Small items to fix eventually that aren't urgent.

- [x] ~~MVP-related: Fix the font flash on reload (FOUT).~~ **DONE.**
      `Layout.astro` now preloads the 4 above-the-fold `.woff2` files
      (Geist 400/600, Cormorant 400/400-italic) via Vite `?url` imports
      and `<link rel="preload" as="font" crossorigin>` tags placed before
      the bundled CSS. Fonts arrive before first paint, swap happens
      silently.

- [ ] Extending the vertical column grid dividers into the bottom Footer
      area is done, but verify visually that `bg-cream/15` reads well across
      all browsers.
- [ ] Footer has external links (`Give`, `Follow Us`, `SITE CREDIT»`) — all
      three use `target="_blank"` already, but the Roman-numeral nav items
      in the Menu column don't. If we add dropdowns for external items, set
      a convention.
- [x] ~~The `/404` page is still the Astro default. Replace with a styled 404.~~
      **DONE.** `src/pages/404.astro` now matches the editorial design.
- [x] ~~**Scripts**: Figma-port helpers were used during the Figma port and are
      not part of the runtime. Either delete or move into `scripts/.archive/`.~~
      **DONE.** All 8 helpers archived under `scripts/.archive/`.
- [x] ~~The Formaloo URL is hardcoded in four places.~~ **DONE.** Both the
      Formaloo `INTERVIEW_URL` and the GivingFuel `GIVE_URL` are now exported
      from `src/lib/links.ts` and imported wherever needed (8 components/pages
      for Formaloo, 2 for Give).
- [ ] **Pre-cutover blocker**: `/resources` links to two external URLs that
      will 404 after DNS cutover —
      `https://trinityclassical.academy/tuition-%26-fee-policy` and
      `https://trinityclassical.academy/uniform-policy`. These point at the
      old Squarespace routes which won't exist on Netlify. Either:
      (a) get the Issuu flipbook URLs and build proper `/resources/tuition`
      and `/resources/uniform` pages,
      (b) add netlify.toml redirects to a still-published mirror, or
      (c) replace the cards with "Coming soon" markers until the policy
      pages exist. See `src/pages/resources.astro:15,23`.
- [ ] **Nav orphans**: `/resources`, `/faq`, and `/careers` are not linked
      from the main nav OR the footer MENU. `/faq` and `/careers` are only
      reachable via `/resources`, which itself is only reachable via direct
      URL or the sitemap. Decide whether to add a "Resources" link to the
      footer (probably correct) or accept this as the design intent.

## Context notes for future sessions

- The site is static-generated via Astro. No backend. Deployed as static
  files to wherever the owner chooses (Vercel / Netlify / Cloudflare Pages).
- The original Figma export is at `docs/Desktop _ Home.svg` (43 MB — don't
  read it directly, it crashes most editors). Use `scripts/render-svg.mjs`
  to view specific regions.
- The video header source (`TCA_Header.mp4`) was compressed from 21 MB to
  ~790 KB (MP4) + 572 KB (WebM) via ffmpeg. Re-run `ffmpeg` if the source
  changes.
- **Geist Sans** is the body font (Vercel's open-source sans). Not Inter —
  that was swapped out. If someone adds a new font reference, use
  `@fontsource/geist-sans`, not `@fontsource/geist`.
- Emblem images live in `src/assets/images/emblem-green.png` (brand-accent
  green for light backgrounds) and `emblem-cream.png` (cream for the dark
  footer). Both are low-resolution and could stand a higher-res source if
  the owner has one.
