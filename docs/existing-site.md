# Existing site audit — trinityclassical.academy

Snapshot of what's live on the old site so we know what content to carry
forward and what external services are in play. Sourced from a research pass
in April 2026.

## Navigation structure (current live site)

Top-level nav has four dropdowns + one direct link:

```
Home
About Us ▾
  ├─ Our Philosophy
  ├─ Our Program
  ├─ Learning Cohorts
  ├─ Join Our Faculty
  ├─ Upcoming Events
  ├─ Leadership
  └─ FAQ
Admissions ▾
  ├─ Enrollment Process
  ├─ Tuition & Fee Policy
  └─ Uniform Policy
Current Families ▾
  ├─ ClassReach (external login)
  └─ Calendar
Giving  (external, GivingFuel)
```

## External services in use

The existing site leans heavily on third-party embeds for anything
interactive. Some of these make sense to keep; others we'll want to rebuild
natively.

| Service         | Used for                               | Keep / Replace                               |
|---              |---                                     |---                                           |
| **Formaloo**    | Interview-request form on Enrollment Process page. URL: `https://trinity-classicalalabama.formaloo.me/tqo8fo` | Keep for now as the primary interview form. Our site's "Request an Interview" CTAs all link to it in a new tab. **NOTE: the URL currently 404s** — that's a Formaloo-side configuration issue. See `roadmap.md`. |
| **Issuu**       | Flipbook viewer for Tuition & Fee Policy PDF and Uniform Policy PDF | Keep as embeds on the Resources pages. Issuu is the right tool for replicating a paginated document feel in-browser. |
| **GivingFuel**  | Donation processor. URL: `https://trinityclassical.givingfuel.com/trinity-classical-academy-general-giving` | Keep. Linked from the Give nav item. |
| **ClassReach**  | LMS / parent portal. URL: `https://trinityclassicalacademy.classreach.com/Login` | Keep as external link. Not something we'd rebuild. |
| **Google Analytics**  | Analytics (tag G-KFG3HXQCP2) | Replicate when we launch — add GA or a simpler alternative (Plausible, Fathom). |
| **reCAPTCHA**   | Spam protection on the homepage contact form | Only matters if we wire the contact form to a real backend. See `pages/admissions.md` for contact form plan. |

## Content inventory

Pages on the existing site and what they contain. Use this as a carry-forward
checklist.

### About Us section

- **Our Philosophy** — the classical Christian education pitch. Goes deep into
  trivium, formation, worldview, liturgy, etc. **This is the content for Our
  Vision on the new site.**
- **Our Program** — the day-to-day shape of what a student experiences. How
  subjects are taught, rhythms of the week, emphasis areas. Goes into
  `pages/how-it-works.md`.
- **Learning Cohorts** — specifics of what cohorts exist (grades served,
  class sizes). Goes into `pages/how-it-works.md`.
- **Join Our Faculty** — employment page. Includes "Now hiring teachers" CTA
  from the homepage. Low priority for rebuild until we need it.
- **Upcoming Events** — event list with dates. Needs calendar solution — can
  use Google Calendar embed, Cal.com, or build our own. Low priority.
- **Leadership** — **THIS IS THE PEOPLE PAGE**. Contains board of directors
  and key leadership. Should expand to also include teachers, support staff,
  and church staff involved in the school. Owner asked for photos. See
  `pages/people.md`.
- **FAQ** — standard FAQ. Goes into `pages/resources.md` or its own page.

### Admissions section

- **Enrollment Process** — three-phase description:
  1. Request an Interview (Formaloo form embedded)
  2. Admissions Interview (in-person, school-led)
  3. Invitation to Apply (sent if the interview confirms fit)
  Goes into `pages/admissions.md`.
- **Tuition & Fee Policy** — Issuu flipbook of a PDF document. Includes the
  tuition table, payment schedule, and financial policies. Goes into
  `pages/resources.md`.
- **Uniform Policy** — same format (Issuu flipbook). Dress code, allowed
  colors, vendor info. Goes into `pages/resources.md`.

### Current Families section

- **ClassReach** — external, just a link. No rebuild needed.
- **Calendar** — school calendar. Could be a Google Calendar embed or a
  static calendar page. Low priority until the school year is running.

### Giving

- External link to GivingFuel donation page. Keep as-is.

## Homepage CTAs on the existing site

- **"Now hiring teachers! Click here for more info"** → `/join-our-faculty`
- **"Click here to join our email list"** → Formaloo signup form (different
  from the interview form)
- **Contact form** on the homepage with fields: Name, Email, Attach Files,
  Send button + reCAPTCHA. The form UI is described as "clunky" by the
  owner.

## Direct contact info on the existing site

- **Email:** info@trinityclassical.academy
- **Physical address:** 7160 Cahaba Valley Rd., Birmingham, AL 35242
- **Church affiliation:** Under the care of Trinity Presbyterian Church

No phone number listed publicly.

## Things the existing site does well that we should preserve

- **Clear three-step enrollment process** — the staged approach (request →
  interview → invitation) sets expectations honestly and avoids over-promising
  acceptance.
- **Honest external embeds for complex documents** — using Issuu for policy
  documents rather than trying to render them inline is the right call for
  flip-book style PDFs.
- **Church affiliation surfaced prominently** — "under the care of Trinity
  Presbyterian Church" is a trust signal for the target audience and should
  stay visible.
- **Email list signup** — good for pre-launch nurturing. We should add one
  back in some form.

## Things that could be improved in the rebuild

- **Visual design** — the existing site is functional but not distinctive.
  The new design language (Cormorant Garamond display, Geist body, IBM Plex
  Mono eyebrows, green + lime palette) will carry the brand much further.
- **Contact form UX** — existing is reCAPTCHA-gated with Attach Files as a
  primary affordance. Simpler, clearer form with an "I'm interested in…"
  dropdown will convert better.
- **Leadership page with photos** — the existing leadership page is
  text-heavy. Faces are what parents look for first.
- **Mobile** — the existing site's mobile experience isn't great. Our rebuild
  is mobile-first from day one.
- **Typography consistency** — mix of fonts and sizes on the existing site
  doesn't hang together. Our design system fixes this.

## Screenshots / assets to extract from the existing site

> TODO: If we want to replicate content verbatim (Philosophy text, Program
> description, FAQ answers), we'll need to pull it from the existing site
> before any update takes it offline. Consider archiving these pages to
> `docs/archive/` as raw markdown.
