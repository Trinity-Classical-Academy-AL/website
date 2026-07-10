# How It Works page — `/how-it-works`

Expands the `HowItWorks` section on the home page (3 program cards: The
Cohort, The Week, The Foundation) into a full dedicated page with room to
actually explain what happens day-to-day at the school.

**Owner quote:**
> The How It Works is also a pretty big one. We have a section on the home
> page for that, and it describes the cohorts, the four-day-a-week, and
> what the classroom looks like. I think a lot more needs to be fleshed
> out there as well.

## The three existing program-card concepts

The home page `HowItWorks` component already names the three anchoring
concepts. This page expands each into a full section.

### 1. The Cohort

Home page says:
> Small groups of 14 or fewer, led by a teacher who knows your child by
> name. Students advance when they've mastered the material — not when the
> year ends.

**Expanded page content needed:**
- What a "cohort" actually is (grade grouping? Multi-age?)
- Student-to-teacher ratio and why it matters
- Mastery-based progression — how it differs from standard
  grade-level promotion
- How cohorts are assembled (by age? by readiness?)
- What happens when a student is ready to move up mid-year

### 2. The Week

Home page says:
> Four days of rigorous classical instruction at school. One day at home
> with your family. We call it partnership because that's what it is.

**Expanded page content needed:**
- Which 4 days are in school and which is home
- What a typical school day looks like (schedule, rhythms of the day,
  lunch, chapel, recess)
- What families do on the home day — is it structured? Unstructured?
  Does the school provide curriculum for home day?
- Why 4 days instead of 5 — is it cost, philosophy, logistics?
- How this compares to homeschool co-ops vs traditional 5-day private
  schools

### 3. The Foundation

Home page says:
> Every subject is taught through the lens of Scripture. Chapel is daily.
> Latin is required. Beauty is not optional.

**Expanded page content needed:**
- What classical subjects are taught (quadrivium / trivium)
- Latin — what grades, what curriculum, why
- Daily chapel — what happens, who leads it
- "Beauty is not optional" — what does this look like in practice?
  (Music, art, poetry, liturgy?)
- Integrated worldview teaching — what does "through the lens of
  Scripture" mean for math or science class specifically

## Proposed page structure

```
────────────────────────────────────────────
HERO
  Eyebrow:  HOW IT WORKS
  Headline: Italic Cormorant, big — "The shape of a day at Trinity."
            or "A day, a week, a life."
  Lead:     2-3 sentences summarizing the pedagogical model:
            small cohorts, mastery-based, 4+1 schedule, classical + Christian.

SECTION 1 — THE COHORT
  Eyebrow:   ONE — THE COHORT
  Heading:   Italic Cormorant, ~44px
  Long-form: 3-5 paragraphs of expanded content
  Optional:  Photo of a cohort in session
  Stat strip: "14 or fewer students" "1 teacher" "Mastery-based progression"

SECTION 2 — THE WEEK
  Eyebrow:   TWO — THE WEEK
  Heading:   Italic Cormorant
  Long-form: 3-5 paragraphs
  Optional:  Schedule grid / visual showing the 4+1 rhythm
  Stat strip: "4 days in school" "1 day at home" "Partnership model"

SECTION 3 — THE FOUNDATION
  Eyebrow:   THREE — THE FOUNDATION
  Heading:   Italic Cormorant
  Long-form: 3-5 paragraphs
  Optional:  Photo of chapel / beauty / Latin class
  Stat strip: "Daily chapel" "Latin K-12" "Integrated curriculum"

CTA BLOCK
  "Ready to meet us?" → /contact or Formaloo Request an Interview
────────────────────────────────────────────
```

## Design direction

- Reuse the home page's `HowItWorks` three-card grid at the top as a
  visual anchor (same three card component), then expand each into its
  own detailed section below.
- The expanded sections should use the site's editorial layout — wide
  body copy with mono eyebrow labels anchored to the left 25% column,
  matching the `/contact` page rhythm.
- Photos are highly encouraged here. Parents looking at a "How It Works"
  page want to see the actual environment.

## Blockers

- **Owner needs to provide the long-form content** for each of the three
  sections. The home page cards have the punch lines; the page needs
  three good paragraphs per concept.
- **Photos of the school in session** — cohort photos, chapel photos,
  Latin class. Low priority until the first school year is underway.

## Open questions

> **QUESTION**: Should the home page `HowItWorks` component link to this
> page? Currently its "Learn More" button goes to `/contact`. Changing it
> to `/how-it-works` once the page exists seems natural.

> **QUESTION**: Should the "4+1" week be shown visually (grid, calendar-
> style) or as prose? A visual grid is clearer but adds design work.
> Recommendation: prose first, add visual later if the owner wants.

> **TODO**: Decide on the stat strip format (3 mini stats per section).
> Similar to how business sites show "100+ clients" etc. In this context
> it could feel hokey; run it by the owner first.

## Implementation checklist

- [ ] **Blocked: owner provides long-form content for each section**
- [ ] Decide on stat-strip inclusion
- [ ] Decide whether to include photos now or stub placeholder
- [ ] Build `src/pages/how-it-works.astro`
- [ ] Reuse `HowItWorks.astro` component at the top as an anchor
- [ ] Build a reusable section block component if sections share structure
- [ ] Update the home-page "Learn More" CTA to point here instead of
      `/contact` (once the page exists)
- [ ] Update nav: swap `#how-it-works` anchor for `/how-it-works`
- [ ] Open Graph image
