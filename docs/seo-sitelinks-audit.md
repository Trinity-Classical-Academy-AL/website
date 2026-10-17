# Sitelinks audit — Trinity Classical Academy

Audited production on 17 Oct 2026 at `https://trinityclassical.academy` (Astro build, Netlify). Titles, meta descriptions, and visible page copy were not rewritten in the implementation that follows this audit. Proposed title and description replacements are listed at the end and are **not applied**.

`og:title` and `og:description` mirror the title and meta description on every page. `og:url` matches the canonical.

## robots.txt and sitemap

`/robots.txt`

- `User-agent: *`
- `Allow: /`
- `Sitemap: https://trinityclassical.academy/sitemap-index.xml`

`/sitemap-index.xml` points at `/sitemap-0.xml`.

Indexed URLs (no `<lastmod>` on production at audit time):

- `https://trinityclassical.academy/`
- `https://trinityclassical.academy/admissions/`
- `https://trinityclassical.academy/careers/`
- `https://trinityclassical.academy/contact/`
- `https://trinityclassical.academy/curriculum/`
- `https://trinityclassical.academy/faq/`
- `https://trinityclassical.academy/how-it-works/`
- `https://trinityclassical.academy/our-vision/`
- `https://trinityclassical.academy/people/`
- `https://trinityclassical.academy/resources/`
- `https://trinityclassical.academy/resources/tuition/`
- `https://trinityclassical.academy/resources/uniform/`

Correctly absent: `/brand-guide` and `/our-philosophy` (both `noindex, nofollow`), `/404`.

## Per page

Internal links below are same-site page links, ignoring assets, fonts, and the shared header/footer set called out once. Header and footer are on every public page, so the shared outbound set is: `/`, `/#our-vision`, `/how-it-works`, `/curriculum`, `/people`, `/admissions`, `/resources`, `/faq`, `/resources/tuition`, `/resources/uniform`, `/careers`, `/contact`.

JSON-LD on every page at audit time was one identical `EducationalOrganization` node (name, mission description, url, logo, email, Birmingham postal address, parent church name, Instagram `sameAs`). No `WebSite`, `BreadcrumbList`, `SiteNavigationElement`, or `FAQPage`.

| Path | Title | Meta description | H1 | Canonical | Robots | JSON-LD |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | Trinity Classical Academy | Trinity Classical Academy partners with families in the joyful discipleship of students through rigorous, Christ-centered classical education. | Truth. Goodness. Beauty. | `https://trinityclassical.academy/` | index | EducationalOrganization |
| `/people` | Our People — Trinity Classical Academy | The board of directors and leadership of Trinity Classical Academy, a ministry of Trinity Presbyterian Church in Birmingham, Alabama. | Built by families, for families. | `https://trinityclassical.academy/people/` | index | EducationalOrganization |
| `/curriculum` | Curriculum Overview - Trinity Classical Academy | An overview of Trinity Classical Academy curriculum choices, including integrated humanities, Latin, music, art, logic, grammar, writing, phonics, geography, science, and mathematics. | Learning you can see. | `https://trinityclassical.academy/curriculum` | index | EducationalOrganization |
| `/how-it-works` | How It Works — Trinity Classical Academy | Small cohorts, mastery-based progression, four days of classical instruction — built around the rhythms of family life. | The shape of a day at Trinity. | `https://trinityclassical.academy/how-it-works/` | index | EducationalOrganization |
| `/admissions` | Admissions — Trinity Classical Academy | The three-step admissions process at Trinity Classical Academy — request an interview, meet with us, and receive your invitation to apply. | How to join Trinity. | `https://trinityclassical.academy/admissions/` | index | EducationalOrganization |
| `/resources/tuition` | Tuition & Fee Policy — Trinity Classical Academy | A complete overview of tuition, enrollment fees, and payment schedules for Trinity Classical Academy. | Tuition & fee policy. | `https://trinityclassical.academy/resources/tuition/` | index | EducationalOrganization |
| `/faq` | Frequently Asked Questions — Trinity Classical Academy | Answers to the questions we hear most about Trinity Classical Academy — location, grades, accreditation, homework, and more. | Questions we hear a lot. | `https://trinityclassical.academy/faq/` | index | EducationalOrganization |
| `/careers` | Join Our Faculty — Trinity Classical Academy | Trinity Classical Academy is hiring teachers who are mature in the Christian faith, gifted at teaching children, and enthusiastic for classical education. | We're hiring teachers. | `https://trinityclassical.academy/careers/` | index | EducationalOrganization |
| `/contact` | Contact — Trinity Classical Academy | Get in touch with Trinity Classical Academy. Request an interview, schedule a visit, or ask a question — we'd love to hear from you. | We'd love to meet you. | `https://trinityclassical.academy/contact/` | index | EducationalOrganization |
| `/resources` | Resources — Trinity Classical Academy | Policies, FAQs, and reference material for current and prospective families at Trinity Classical Academy. | Policies, fees, and answers. | `https://trinityclassical.academy/resources/` | index | EducationalOrganization |
| `/resources/uniform` | Uniform Policy — Trinity Classical Academy | Details on the required uniform for all students at Trinity Classical Academy, including approved vendors and dress code guidelines. | Uniform policy. | `https://trinityclassical.academy/resources/uniform/` | index | EducationalOrganization |
| `/our-vision` | Our Vision — Trinity Classical Academy | Trinity Classical Academy is unapologetically Christian and wholly transformative — grounded in the truth of the Triune God and the inerrant Scriptures. | Truth. Goodness. Beauty. | `https://trinityclassical.academy/our-vision/` | index | EducationalOrganization |
| `/our-philosophy` | Our Philosophy — Trinity Classical Academy | The philosophy of education and subject statements of Trinity Classical Academy. | Our Philosophy Of Education | `https://trinityclassical.academy/our-philosophy` | noindex, nofollow | EducationalOrganization |
| `/brand-guide` | Brand Guide — Trinity Classical Academy | Internal brand reference. | Brand guide. | `https://trinityclassical.academy/brand-guide/` | noindex, nofollow | EducationalOrganization |
| `/404` | Page not found — Trinity Classical Academy | The page you requested could not be found. | Absent from homeroom. | `https://trinityclassical.academy/404/` | noindex, nofollow | EducationalOrganization |

### Links in and out

Shared header/footer links reach every indexable section except `/our-vision`.

Page-specific internal links beyond that shared set:

- `/admissions` also links to `/contact` in the page body.
- `/curriculum` also links to `/careers` in the page body.
- `/faq` also links to `/contact` in the page body.
- `/our-vision` also links to `/people` in the page body. Nothing linked to `/our-vision`.
- `/resources` also links to `/resources/tuition`, `/resources/uniform`, `/faq`, `/careers`, and `/TCA-Academic-Calendar-2026-2027.pdf`.
- `/resources/tuition` and `/resources/uniform` each link back to `/resources` (visible “← Resources” plus the footer).
- `/404` links to `/` and `/contact`.
- `/our-philosophy` and `/brand-guide` are intentionally absent from header, footer, and the sitemap.

`/our-vision` was the only indexable orphan. Header and footer “Our Vision” point at `/#our-vision` (the homepage Core Beliefs section), not at `/our-vision`.

## Duplicates and overlap

No two pages share an identical `<title>` or meta description.

Overlaps that make sitelinks less distinct:

- `/` and `/our-vision` use the same H1: “Truth. Goodness. Beauty.”
- The homepage meta description is the same mission sentence as the footer and the JSON-LD organization description, so the main result snippet does not say Birmingham, grades, or classical Christian school. Those facts are on the hero.
- `/curriculum` is the only indexable title using a hyphen (`Overview - Trinity`) instead of the em dash used everywhere else. Its canonical omitted the trailing slash (`/curriculum`) while the sitemap, the redirect, and every other indexable canonical used a trailing slash.
- `/our-philosophy` (noindex) had the same trailing-slash mismatch.
- `/careers` title is “Join Our Faculty”, so a Careers sitelink would not say Careers. Nav label is Careers.
- `/people` title is “Our People”; nav label is People.
- `/faq` title is the long form “Frequently Asked Questions”; nav label is FAQ.
- `/contact` and `/admissions` both lead with “request an interview”.
- `/resources` description says “FAQs”, which overlaps the FAQ description without naming tuition, uniform, or the calendar.
- `/our-vision` description repeats the “unapologetically Christian / wholly transformative” line and does not say the page is the subject-by-subject vision.
- JSON-LD `sameAs` listed Instagram, which is not a visible link. The footer Facebook profile was not in `sameAs`. No public phone number or founding date exists on the site (and none was added).

Visible breadcrumbs were not added. Subpages already have “← Home” in the header, and tuition/uniform already have “← Resources” above the eyebrow. Another trail would sit in the same band as the display H1.

## Applied with this change

Titles, meta descriptions, H1s, and body copy are unchanged.

- JSON-LD on every page is now a schema.org `@graph`: `EducationalOrganization` + `School`, `WebSite`, and an `ItemList` of `SiteNavigationElement` for the internal main nav. Non-home pages add `BreadcrumbList` (Home > Resources > Tuition, and the same pattern elsewhere). `/faq` adds `FAQPage` using the on-page questions and answers.
- Facebook, already linked in the footer, was added to `sameAs`. Instagram stays. The church URL already in the footer was added to `parentOrganization`. No phone number or founding date was added.
- `/our-vision` is linked from the homepage Core Beliefs block (“Our Vision →”), the footer (“Educational Vision”), and the curriculum page (“Our Vision →”). Header “Our Vision” still goes to `/#our-vision`.
- Sitemap `<lastmod>` is the commit date of each page source. `/brand-guide` and `/our-philosophy` stay out.
- `/curriculum` and `/our-philosophy` canonicals now use the same trailing slash as the rest of the site and the sitemap. The production domain is unchanged.

Visible breadcrumbs were not added. Subpages already show “← Home”, and tuition and uniform already show “← Resources”.

## Recommended title and meta description rewrites

Approved and applied. H1s were left as they were. `og:title` and `og:description` follow the title and meta description. The table is the copy that shipped.

| Path | Proposed title | Proposed meta description |
| --- | --- | --- |
| `/` | Trinity Classical Academy — Birmingham, AL | ACCS-mentored classical Christian school in Birmingham, Alabama, under Trinity Presbyterian Church. Grades K–8, adding a grade each year toward K–12. |
| `/people` | People — Trinity Classical Academy | People at Trinity Classical Academy: the board of directors, faculty, and leadership of this ministry of Trinity Presbyterian Church in Birmingham, Alabama. |
| `/curriculum` | Curriculum — Trinity Classical Academy | Curriculum at Trinity Classical Academy: integrated humanities, Latin, music, art, logic, grammar, writing, phonics, geography, science, and mathematics. |
| `/how-it-works` | How It Works — Trinity Classical Academy | How Trinity Classical Academy works: small cohorts, mastery-based progression, and four days of classical instruction built around the rhythms of family life. |
| `/admissions` | Admissions — Trinity Classical Academy | Admissions at Trinity Classical Academy: request an interview, meet with the school, and receive an invitation to apply. |
| `/resources/tuition` | Tuition — Trinity Classical Academy | Tuition and fee policy for Trinity Classical Academy, including enrollment fees and payment schedules. |
| `/faq` | FAQ — Trinity Classical Academy | FAQ for Trinity Classical Academy: location, grades, uniform, classical education, accreditation, the school day, homework, and financial aid. |
| `/careers` | Careers — Trinity Classical Academy | Careers at Trinity Classical Academy: teachers who are mature in the Christian faith, gifted at teaching children, and enthusiastic for classical education. |
| `/contact` | Contact — Trinity Classical Academy | Contact Trinity Classical Academy: email the school, ask a question, or schedule a visit at 7160 Cahaba Valley Rd., Birmingham, AL 35242. |
| `/resources` | Resources — Trinity Classical Academy | Resources for Trinity Classical Academy families: tuition policy, uniform policy, academic calendar, curriculum guide, FAQ, and the parent portal. |
| `/resources/uniform` | Uniform — Trinity Classical Academy | Uniform policy for Trinity Classical Academy: required dress for every student, approved vendors, and dress code guidelines. |
| `/our-vision` | Our Vision — Trinity Classical Academy | Our vision at Trinity Classical Academy: Christian formation in humanities, mathematics, Bible, science, history, literature, language, art, and music. |

`/our-philosophy`, `/brand-guide`, and `/404` are noindex and are not sitelink candidates. Leave their titles and descriptions as they are.

Separate from titles: the duplicate H1 on `/` and `/our-vision` is worth a later decision. This pass did not change either H1.
