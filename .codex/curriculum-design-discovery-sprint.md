# Curriculum Page No-Code Discovery Sprint

Date: 2026-06-04
Repo: `/Users/bryantbrock/brocksoftware/tca/tca-landing`
Target route: `/curriculum`
Status: discovery artifact only. No Astro, CSS, asset, build, deploy, or PR changes.

## Operating Frame

The next good curriculum page will not come from asking for another curriculum
page design. That phrase pulls agents back into private-school site conventions:
hero, intro copy, subject cards, vendor logos, source note, CTA.

This sprint moves the work upstream:

- references before layouts
- information architecture before styling
- metaphors before components
- criticism before visual polish
- explicit anti-brief before any design agent runs

## Bryant Selection: Art as the Curriculum Doorway

Selected direction: The Exhibition of One Story.

What Bryant responded to:

- real art, not decorative school imagery
- the true artistic nature of the page
- "All truth is God's truth" as the governing conviction
- one artwork opening into history, literature, art history, culture, religion,
  theology, philosophy, and political imagination
- learning to look closely, then learning to think like a historian
- the sense that history has layers: a single image becomes an entry point into
  the larger story

Refined direction: The curriculum page should become an interactive exhibition
of integrated humanities. It should use one major artwork as the doorway into
the whole educational philosophy. A parent should see how Trinity teaches
students to observe, interpret, contextualize, and connect: not art as an
elective, but art as a visible compression of history, theology, power,
language, literature, and culture.

The page is no longer primarily "these are our curriculum vendors." It is:

> Here is how a child learns to see one ordered world.

Candidate anchor artwork:

- Unknown artist, `An Allegory of the Tudor Succession: The Family of Henry
  VIII`, ca. 1590
- Collection: Yale Center for British Art, Paul Mellon Collection, B1974.3.7
- Source: https://collections.britishart.yale.edu/catalog/tms:168
- Rights: Yale manifest and Wikimedia Commons list the image/work as public
  domain / CC0 or public domain mark
- Why it works: succession, Reformation, allegory, monarchy, peace/war,
  Protestant/Catholic conflict, Elizabethan political imagination, costume,
  symbolism, art patronage, and rhetoric are all visible in one scene

Immediate next step: build a disposable interactive concept page, not production
UI, that tests whether one artwork can carry the curriculum argument before the
page lists any subject or vendor.

Prototype artifact:

- HTML: `/Users/bryantbrock/brocksoftware/tca/tca-landing/qa-media/curriculum-exhibition-one-story-prototype.html`
- Screenshot: `/Users/bryantbrock/brocksoftware/tca/tca-landing/qa-media/curriculum-exhibition-one-story-prototype.png`
- Local artwork asset: `/Users/bryantbrock/brocksoftware/tca/tca-landing/qa-media/tudor-succession-prototype.jpg`
- Prototype behavior: first viewport gives the artwork room to carry the
  argument; lower section lets the viewer switch layers for history, theology,
  power, rhetoric, art, and culture
- Production status: do not ship this file as-is. It is a taste and interaction
  test before rewriting the Astro `/curriculum` page.

## Failure Autopsy

The current page is a competent implementation of the wrong design search. It
has these structural anchors:

- a `Curriculum` hero with a large italic serif title
- a featured Integrated Humanities band
- a subject list/grid with logos or source labels
- alternating surface treatments
- legal/source note
- final CTA

That structure makes the page feel like a catalog of vendor choices. The real
job is bigger: convince a skeptical parent that the curriculum is a coherent
formation system, not a list of purchased programs.

The bad options failed because they changed the arrangement, not the premise.
They were still rearranging the same ingredients: page title, section bands,
logos, cards, rows, and subject blurbs.

## Anti-Brief

Every future design prompt must paste this in full.

Do not:

- do not open with a generic hero titled "Curriculum"
- do not use a big hero followed by stacked sections
- do not use an equal-weight subject card grid
- do not use a logo cloud or logo wall
- do not make third-party logos the visual center of the page
- do not use a dark featured card as the main trick
- do not make the page a decorated spreadsheet
- do not use alternating cream and white bands as the primary design move
- do not flatten Integrated Humanities into "one of several subjects"
- do not make it feel like any other private school or EdTech curriculum page
- do not frame the page as "we use these vendors"
- do not rely on Cormorant italics as the differentiator
- do not show all subjects as equal unless the chosen IA intentionally argues that
- do not ask a visual designer to start from the current Astro layout

The page must:

- make an argument before it lists ingredients
- show why the choices hang together
- give Integrated Humanities philosophical primacy
- make the skeptical parent feel the curriculum has order, seriousness, and soul
- feel institutionally confident without feeling generic, precious, or theatrical
- answer "why these choices?" in under 90 seconds

## Reference Board

These references are not look-and-copy sources. They are structure sources.
Each one points to a transferable move that can escape the school-page genre.

### Museum, Archive, and Exhibition Logic

1. MoMA exhibition history
   URL: https://www.moma.org/calendar/about/exhibition-history
   Transfer: curriculum as a living archive, where each entry belongs to a
   historical sequence and a curatorial record.

2. MoMA exhibition listing
   URL: https://www.moma.org/calendar/exhibitions/history
   Transfer: dense chronology with metadata, not marketing cards.

3. The Met exhibitions
   URL: https://www.metmuseum.org/exhibitions?location=main
   Transfer: exhibition as thesis plus selected objects, with the image/title
   pairing carrying editorial weight.

4. National Gallery of Art exhibitions
   URL: https://www.nga.gov/calendar?tab=exhibitions
   Transfer: current/upcoming/special-installation grouping as a way to separate
   core, sequence, and supporting studies.

5. Library of Congress current exhibitions
   URL: https://www.loc.gov/exhibits/current/
   Transfer: institutional authority through primary-source framing, dates,
   locations, and collection context.

6. V&A collections
   URL: https://www.vam.ac.uk/collections
   Transfer: collection taxonomy plus editorial storytelling, useful for
   "subjects as ordered knowledge" rather than "programs as products."

7. Smithsonian Collections Search Center
   URL: https://collections.si.edu/search/
   Transfer: search, facets, and object metadata as a model for restrained,
   serious information density.

8. Smithsonian Library and Archival Exhibitions on the Web
   URL: https://library.si.edu/digital-library/exhibition/library-and-archival-exhibitions-web
   Transfer: archive index as a format; many small entries can still feel
   curated if the taxonomy is strong.

9. Smithsonian Archives of American Art digital collections
   URL: https://www.aaa.si.edu/collections/online
   Transfer: the page can feel like a research room: precise, textured, and
   built around evidence.

### Academic Catalog and Prospectus Logic

10. Yale Subjects of Instruction
    URL: https://catalog.yale.edu/ycps/subjects-of-instruction/
    Transfer: A-Z structure, formal categories, and official record tone without
    decorative UI.

11. Harvard College concentrations
    URL: https://college.harvard.edu/academics/liberal-arts-sciences/concentrations
    Transfer: fields of study grouped by domain, then expanded by path and
    requirements.

12. University of Chicago Core
    URL: https://collegecatalog.uchicago.edu/thecollege/thecore/
    Transfer: a curriculum can be introduced as a philosophical commitment
    before courses are named.

13. MIT OpenCourseWare
    URL: https://openlearning.mit.edu/courses-programs/mit-opencourseware
    Transfer: open curriculum as a browsable body of materials, not a sales page.

14. Harvard Archived Course Catalogs
    URL: https://library.harvard.edu/collections/archived-harvard-university-online-course-catalogs
    Transfer: historical catalogs as evidence of intellectual continuity and
    institutional memory.

15. Ohio University Course Catalogs and Bulletins
    URL: https://www.ohio.edu/library/collections/digital-archives/ohio-university-archives/course-catalogs-bulletins
    Transfer: old bulletins combine rules, faculty, courses, photos, and campus
    life into one institutional artifact.

16. University of Maryland historical course catalogs
    URL: https://www.lib.umd.edu/collections/university-archives/digital/course-catalogs
    Transfer: course catalogs as archival documents, useful for a dignified
    "prospectus" direction.

17. William & Mary catalogs
    URL: https://www.wm.edu/offices/registrar/catalogs-calendars-exams/catalogs/
    Transfer: long-running catalog archive as trust signal; curriculum belongs
    to an ongoing tradition.

### Liturgical, Seasonal, and Ordered-Time Logic

18. USCCB liturgical calendar
    URL: https://www.usccb.org/about/divine-worship/liturgical-calendar/index.cfm
    Transfer: rank, color, citation, and cycle can organize a year without
    feeling like a marketing timeline.

19. USCCB liturgical colors
    URL: https://www.usccb.org/prayer-and-worship/liturgical-year-and-calendar/understanding-the-liturgical-colors
    Transfer: color is not decoration; it encodes season, purpose, and rank.

20. Vanderbilt Revised Common Lectionary
    URL: https://lectionary.library.vanderbilt.edu/daily-readings-bu/
    Transfer: daily/seasonal readings show how ordered fragments can form a
    coherent whole over time.

21. Oremus Almanac for Common Worship
    URL: https://almanac.oremus.org/
    Transfer: calendar plus lectionary plus files for real use; utility and
    sacred order can coexist.

### Field Guide and Taxonomy Logic

22. Audubon Guide to North American Birds
    URL: https://www.audubon.org/bird-guide
    Transfer: subject entries can be field-guide entries with traits, habitat,
    method, and observation cues.

23. Audubon Gray Catbird field guide page
    URL: https://www.audubon.org/field-guide/bird/gray-catbird
    Transfer: one entry can combine description, range, images, climate data,
    and expert notes without becoming a card.

24. eBird Explore
    URL: https://ebird.org/explore
    Transfer: data-backed exploration; region, time, map, and species create a
    browsable knowledge system.

25. eBird species profile guidance
    URL: https://support.ebird.org/en/support/solutions/articles/48001255128-find-birds-with-ebird
    Transfer: species profiles combine map, stats, media, description, and
    nearest relatives. A subject could have equivalents.

26. iNaturalist taxa
    URL: https://www.inaturalist.org/taxa
    Transfer: taxonomy, observation, and community evidence as a model for
    "how to identify this discipline in practice."

### Book Catalog, Canon, and Press Logic

27. Penguin Classics
    URL: https://www.penguin.co.uk/about/publishing-houses/penguin-press/penguin-classics
    Transfer: a series identity can carry thousands of works without every work
    needing equal visual drama.

28. Penguin Classics catalog
    URL: https://www.penguin.co.uk/authors/3682/
    Transfer: official catalog with author, sub-series, genre, and ISBN; useful
    for serious bibliographic density.

29. Oxford World's Classics
    URL: https://www.oupjapan.co.jp/en/academic/owc/index.shtml
    Transfer: classic texts supported by introductions, notes, chronologies,
    bibliographies, maps, glossaries, indexes, and appendices.

30. New York Review Books about NYRB Classics
    URL: https://www.thenyrb.com/pages/about
    Transfer: the series makes a claim about rediscovery and cultural memory,
    not just "books we sell."

31. Harvard University Press about Loeb
    URL: https://www.hup.harvard.edu/about
    Transfer: translation series as a trust and continuity signal; facing-page
    logic could inspire "source / formation" pairings.

32. The Folio Society
    URL: https://www.foliosociety.com/
    Transfer: premium publishing as tactile seriousness; book-as-object without
    needing a school-photo hero.

### Journey, Preparation, Craft, and Built-World Logic

33. National Park Service plan your visit
    URL: https://www.nps.gov/planyourvisit/index.htm
    Transfer: "pick, prepare, visit" sequence; curriculum choices can be
    presented as preparation for a journey.

34. Zion planning guide
    URL: https://www.nps.gov/zion/planyourvisit/planning-guide.htm
    Transfer: visitor guide structure: conditions, essentials, routes, warnings,
    and what to expect.

35. SO-IL architecture
    URL: https://www.so-il.org/
    Transfer: sparse portfolio confidence; each project is a proposition, not
    a tile in a marketing grid.

36. SO-IL about
    URL: https://www.so-il.org/about/
    Transfer: craft, detail, construction, and human impact as a way to write
    about the "why" of materials and methods.

37. Kanki Lab
    URL: https://kankilab.com/
    Transfer: craft education can be organized around courses, shop, knowledge,
    and cafe without losing material warmth.

38. Senpo
    URL: https://www.senpo.studio/
    Transfer: inherited craft plus process; good model for "tradition carried
    forward by living teachers."

39. Eriko Horiki process
    URL: https://www.eriko-horiki.com/en/process-en/
    Transfer: process narrative gives authority to material choices.

## IA Options

These are information architectures, not visual designs.

### IA 1: The Formation Path

Reader journey: A parent enters through the question "What kind of person is
this curriculum forming?" The page moves from end-state virtues to the practices
that train them, then to the curriculum sources that support those practices.
Integrated Humanities sits at the center as the narrative spine.

Best if the page is a parent trust page.

### IA 2: The Canon and the Instruments

Reader journey: The page first names the canon or body of knowledge Trinity is
trying to hand down. Then each curriculum source is presented as an instrument:
phonograms, sentence structure, imitation, Latin, mathematical reasoning,
scientific discovery, music, logic, rhetoric.

Best if the page is a "why we chose this" manifesto.

### IA 3: The Field Guide to a Trinity Education

Reader journey: Each discipline is introduced like a field guide entry: how to
recognize it, what habits it trains, what tools it uses, what fruit it bears,
and what mistakes it avoids. Integrated Humanities becomes the "habitat" where
the other disciplines are seen in relation.

Best if the page needs to make many subjects browsable without becoming a grid.

### IA 4: The Ordo

Reader journey: The page follows ordered time: daily rhythms, weekly practices,
yearly cycles, then grade-span progression. Curriculum choices appear as part of
a repeated formative calendar rather than as standalone purchases.

Best if the page should feel distinctly Christian and ordered without becoming
ornamental.

### IA 5: The Prospectus

Reader journey: The page feels like a small institutional bulletin: thesis,
course of study, methods, sources, notes for parents, and official record. It is
text-forward, precise, and confident. Logos are demoted to source citations.

Best if the page should feel authoritative, archival, and serious.

### IA 6: The Exhibition

Reader journey: The page is curated around one thesis: "All truth is God's
truth, taught as one story." It has a short wall text, then selected "objects"
or "studies" that show how the thesis appears in reading, grammar, writing,
Latin, math, science, music, logic, and rhetoric.

Best if the page needs a strong editorial concept and a memorable first pass.

## Rough Concept Divergence

These are thumbnails in words. They are intentionally not implementation-ready.

1. Field Guide to Formation
   Pattern: taxonomy entries with traits, tools, warnings, and fruit.
   Primary references: Audubon, eBird, iNaturalist.

2. The School Bulletin
   Pattern: formal prospectus with course of study, notes, and source citations.
   Primary references: Yale catalog, Ohio bulletins, William & Mary archive.

3. The Exhibition of One Story
   Pattern: curatorial wall text plus selected objects.
   Primary references: MoMA, LOC exhibitions, The Met.

4. The Ordo Studiorum
   Pattern: ordered calendar of practices and disciplines.
   Primary references: USCCB calendar, Vanderbilt lectionary, Oremus.

5. The Canon and Its Tools
   Pattern: canon first, tools second, vendors last.
   Primary references: Penguin Classics, Oxford World's Classics, Loeb.

6. The Apprentice's Bench
   Pattern: each subject is a tool on a workbench, introduced by what it trains
   the hand/mind to do.
   Primary references: Kanki Lab, Senpo, Eriko Horiki.

7. The Map Room
   Pattern: disciplines as territories in one ordered map.
   Primary references: NPS guides, V&A collections, Smithsonian search.

8. The Reading Room
   Pattern: quiet archive with shelves, call numbers, marginal notes, and
   selected source records.
   Primary references: LOC, Harvard A-Cats, Smithsonian Archives.

9. The Course of Study
   Pattern: an old-school institutional course catalog with restrained sections.
   Primary references: UChicago Core, Yale catalog, Maryland catalogs.

10. The Ladder of Habits
    Pattern: practices stack from observation to imitation to mastery.
    Primary references: MIT OCW, craft-process pages.

11. The Formation Ledger
    Pattern: serious ledger of aims, practices, materials, and evidence.
    Primary references: academic bulletins, catalogs, collection metadata.

12. The Cabinet of Studies
    Pattern: curated compartments, each holding a discipline and its evidence.
    Primary references: museum collections, V&A object pages.

13. The Parent's Guidebook
    Pattern: "what to expect, how to prepare, what to watch for."
    Primary references: NPS Plan Your Visit, Zion guide.

14. The Great Conversation
    Pattern: show the curriculum as a conversation across history.
    Primary references: Loeb, Penguin Classics, NYRB Classics.

15. The Spine and the Limbs
    Pattern: Integrated Humanities is the spine; every other discipline is
    connected as a limb.
    Primary references: anatomy diagrams and catalog hierarchy, not a logo grid.

16. The Sequence of Questions
    Pattern: organize by questions students learn to ask.
    Primary references: field guides, science discovery sequence, UChicago Core.

17. The House of Learning
    Pattern: foundation, rooms, beams, and threshold as structure.
    Primary references: architecture portfolios and craft.

18. The Rule of Study
    Pattern: curriculum as a rule of life: daily, weekly, yearly practices.
    Primary references: liturgical calendars and almanacs.

19. The Index of Loves
    Pattern: alphabetic or thematic index of what the school wants students to
    love, followed by the studies that train those loves.
    Primary references: book indexes, Yale A-Z, Penguin catalog.

20. The Table of Correspondences
    Pattern: each curriculum source maps to one habit, one method, one virtue,
    one evidence point.
    Primary references: collection metadata and academic requirement tables.

21. The Pilgrim's Kit
    Pattern: curriculum choices as what students carry for the journey.
    Primary references: NPS essentials, expedition guides.

22. The Marginalia Page
    Pattern: main thesis in center, subject notes in margins.
    Primary references: annotated classics and scholarly apparatus.

23. The Museum Label Page
    Pattern: each discipline gets a precise label: title, date/order, material,
    method, purpose.
    Primary references: museum object labels.

24. The Living Syllabus
    Pattern: a syllabus that is less about assignments and more about ordered
    formation.
    Primary references: MIT OCW, Yale catalog.

25. The Workshop Inventory
    Pattern: tools are listed as inventory, but grouped by work they accomplish.
    Primary references: craft studios and field equipment lists.

## Critic Pass

### Kill Immediately

These are too close to the failed page or too likely to collapse into generic
UI:

- The Course of Study
- The Formation Ledger
- The Cabinet of Studies
- The Parent's Guidebook
- The House of Learning
- The Table of Correspondences
- The Workshop Inventory
- The Ladder of Habits
- The Map Room
- The Reading Room
- The School Bulletin, unless it becomes deliberately archival rather than web-catalog
- The Living Syllabus, unless it has a sharper Christian formation thesis
- The Spine and the Limbs, unless it avoids diagram kitsch
- The Great Conversation, unless it avoids generic classical-school rhetoric
- The Pilgrim's Kit, unless it avoids campy journey language

### Keep in Contention

These have enough distance from the current implementation to be worth
developing:

1. Field Guide to Formation
   Why it survives: it gives each subject a function and observable traits
   without turning subjects into equal cards.

2. The Exhibition of One Story
   Why it survives: it makes the page argumentative and curatorial instead of
   catalog-like.

3. The Ordo Studiorum
   Why it survives: it gives the page a Christian structure based on ordered
   time, practice, rank, and repetition.

4. The Canon and Its Tools
   Why it survives: it demotes vendors and elevates the intellectual tradition.

5. The Apprentice's Bench
   Why it survives: it makes method tangible and breaks the school-site pattern.

### Top Three To Visualize Later

Do not produce image mockups for these until Bryant selects references and a
thesis sentence. The briefs below are pre-image visual briefs: they describe
layout gestures and failure modes, but they are not implementation specs.

1. The Exhibition of One Story
2. Field Guide to Formation
3. The Ordo Studiorum

## Pre-Image Visual Briefs

These are the three directions a visual agent should explore first after the
selection gate. They are deliberately written without Astro, Tailwind, final
copy, or component assumptions.

### Direction 1: The Exhibition of One Story

Strategic premise: Treat the curriculum as a curated exhibition around one
thesis: all truth belongs to God's ordered world, so history, language, number,
nature, beauty, and worship are taught as one story. The page should feel like
an institutional exhibition, not a vendor list.

First viewport gesture: A short curatorial wall-text block sits beside a
structured sequence of "studies." Integrated Humanities is not a featured card;
it is the interpretive thesis that explains the whole room.

Content rhythm:

1. curatorial thesis
2. interpretive spine: Integrated Humanities
3. selected studies grouped by what they reveal, not by vendor
4. source notes treated like museum labels
5. parent-facing conclusion: why these choices cohere

Logo/source treatment: no logos in the main reading path. Sources appear as
small museum-label citations: source name, discipline, official link. If a mark
is shown at all, it is secondary evidence, never the visual object.

Typography, surface, and color: restrained museum typography, generous margins,
quiet labels, thin rules, off-white paper, black ink, one disciplined green as
institutional color, and one muted accent for "labels." Avoid cream/green
romance and oversized decorative serif gestures.

Mobile behavior: one continuous exhibit walk. Labels collapse under each study,
but the thesis remains sticky or recurring as a small text refrain so the page
does not become a subject list.

Why it differs from the current page: it replaces hero + featured band + subject
cards with a curatorial argument and demotes vendor identity to citation.

What would make it fail: if every study becomes a card, if the page borrows
museum styling without a strong thesis, or if Integrated Humanities becomes just
the first exhibit item.

Rough thumbnail:

```text
+------------------------------------------------------+
| TCA mark        CURRICULUM AS ONE STORY       notes  |
|                                                      |
| [wall text: 4-5 lines, thesis-forward]               |
|                                                      |
| 01  INTEGRATED HUMANITIES                            |
|     The interpretive spine of the room               |
|     -------------------------------------------      |
|     source label: Concordis / official link          |
|                                                      |
| 02  LANGUAGE       03  NUMBER       04  NATURE       |
|     what it trains what it reveals what it corrects  |
|                                                      |
| 05  BEAUTY         06  REASON       07  SPEECH       |
+------------------------------------------------------+
```

### Direction 2: Field Guide to Formation

Strategic premise: Treat each discipline as something a parent can learn to
recognize in the life of a student. The page should answer: what habits does
this curriculum train, what are the signs of growth, and why did Trinity choose
these tools?

First viewport gesture: A compact "field key" opens the page: habits, methods,
tools, and fruit. The parent is invited to inspect the curriculum as a living
formation ecology rather than a menu of subjects.

Content rhythm:

1. field key: habits the curriculum trains
2. habitat: Integrated Humanities as the environment where meaning coheres
3. discipline entries with repeated field-guide metadata
4. signs of growth for each area
5. source appendix for curriculum providers

Logo/source treatment: logos are replaced by a "materials used" line inside each
entry or an end appendix. The page reads source names, not marks. Links remain
available for trust and transparency.

Typography, surface, and color: field-guide clarity, small caps labels,
structured metadata, restrained illustrations or line symbols if needed. Use a
neutral paper base, black text, green as taxonomy/category coding, and a small
set of secondary tones only where they encode type of formation.

Mobile behavior: each entry becomes a compact field profile with the same
sequence: habit, method, evidence, material. Use lightweight row separation, not
cards. The parent can scan by habit first, source second.

Why it differs from the current page: it changes the organizing unit from
"curriculum source" to "observable formation." Vendors become materials, not
the page's primary nouns.

What would make it fail: if it becomes a playful nature theme, if every entry is
boxed like a card, or if the repeated profile structure turns into a spreadsheet.

Rough thumbnail:

```text
+------------------------------------------------------+
| FIELD GUIDE TO FORMATION                             |
| Key: attention / memory / language / reason / wonder |
|                                                      |
| HABITAT                                              |
| Integrated Humanities: the story environment         |
|                                                      |
| ENTRY 01  READING & SPELLING                         |
| Habit trained: attention to ordered language         |
| Method: phonograms, rules, hand-written practice     |
| Sign of growth: reads and spells unseen words        |
| Material: Spell to Write and Read                    |
|                                                      |
| ENTRY 02  GRAMMAR                                    |
| Habit / method / sign / material                     |
+------------------------------------------------------+
```

### Direction 3: The Ordo Studiorum

Strategic premise: Present curriculum as ordered study: daily practice, yearly
sequence, and intellectual hierarchy. This direction should feel Christian
without leaning on decoration; order, recurrence, rank, and proportion do the
work.

First viewport gesture: A rule-of-study panel names the central conviction, then
shows ordered bands of formation: daily, weekly, yearly, and across the grades.
Integrated Humanities appears as the primary season or spine of interpretation.

Content rhythm:

1. rule of study: one thesis and three ordered commitments
2. daily/weekly/yearly rhythms
3. grade-span sequence: lower, middle, upper preparation
4. disciplines grouped by practice type: read, speak, number, observe, sing,
   reason
5. source register at the end

Logo/source treatment: no logos in the main body. Source names sit in a
register, like lectionary citations or rubrics. The visual language should say
"ordered practice," not "brand partnership."

Typography, surface, and color: formal but warm. Use columns, rules, ordinal
labels, and restrained rubric color. Green can act like liturgical rank or
instructional notation, not a decorative wash. Avoid ecclesial cosplay,
parchment effects, medieval styling, or ornate borders.

Mobile behavior: the ordered bands become a vertical rule. Each section begins
with a concise rubric line, then expands to the curriculum materials. The user
should always know where a discipline sits in the order.

Why it differs from the current page: it organizes curriculum by time and
formation rhythm rather than by vendor/source sections.

What would make it fail: if it becomes a timeline diagram, if it gets too
churchy visually, or if the order is decorative instead of explanatory.

Rough thumbnail:

```text
+------------------------------------------------------+
| ORDO STUDIORUM                                       |
| Rule: children learn one ordered world under Christ   |
|                                                      |
| DAILY PRACTICE        WEEKLY RHYTHM      YEARLY ARC  |
| read / recite         discuss / sing     sequence    |
| write / reckon        observe / reason   memory      |
|                                                      |
| I. THE SPINE                                          |
|    Integrated Humanities                              |
|                                                      |
| II. THE ARTS OF LANGUAGE                              |
|     Reading / Grammar / Writing / Latin              |
|                                                      |
| III. THE ARTS OF ORDER                                |
|      Mathematics / Science / Music / Logic           |
|                                                      |
| Source register: names and official links            |
+------------------------------------------------------+
```

## Critic Recommendation

Explore The Exhibition of One Story first. It has the sharpest distance from the
current Astro page because it changes the page's genre from "curriculum listing"
to "curatorial argument." It also preserves the most useful part of the current
content: Integrated Humanities as the philosophical center.

Field Guide to Formation should be the second exploration if Bryant wants a more
practical parent-facing page. The Ordo Studiorum is the riskiest and potentially
most distinctive; it needs the most restraint to avoid becoming decorative.

## Thesis Sentence Candidates

These are not final copy. They are POV tests.

1. Trinity's curriculum is not a shelf of programs; it is an ordered way of
   teaching children to read God's world truthfully.

2. We choose materials for what they train: attention, memory, language,
   reasoning, wonder, worship, and charity.

3. The center is one story: God orders history, language, number, nature, and
   beauty, and children should learn them as one world.

4. A classical Christian curriculum is not nostalgia; it is disciplined
   attention to what forms a free and faithful person.

5. The question is not only what students study, but what their studies teach
   them to love.

## Hard Gates Before Design

No visual design agent should run until all gates are satisfied:

1. Reference board approved
   Bryant chooses 8-12 references from the board and marks 3 as highest-signal.

2. IA selected
   Bryant chooses one IA or a hybrid.

3. Thesis selected
   Bryant chooses or edits one thesis sentence.

4. Anti-brief included
   The full anti-brief is pasted into every future design prompt.

5. Concept survives critic
   Any visual concept must pass: not a hero/section/card page, not vendor-logo
   centered, not another variation of the current Astro page.

## No-Write Agent Setup

Use Claude Sonnet or other design agents only in modes that cannot mutate the
repo.

Recommended Claude command:

```bash
claude -p --model sonnet \
  --setting-sources user \
  --permission-mode default \
  --allowedTools "Skill,Read,Glob,Grep,WebFetch,mcp__uidotsh__uidotsh_fetch" \
  --disallowedTools "Edit,Write,MultiEdit,Bash"
```

Alternate stricter planning mode:

```bash
claude -p --model sonnet \
  --setting-sources user \
  --permission-mode plan \
  --allowedTools "Skill,Read,Glob,Grep,WebFetch,mcp__uidotsh__uidotsh_fetch"
```

Important: include `Skill`; otherwise Claude may be unable to invoke `/ui`.

### Agent 1: Reference Researcher

Prompt:

```text
Use /ui if available. Do not edit files. Do not propose a page design.

Find and categorize 30-40 non-school references for a classical Christian
curriculum page. Avoid school websites and EdTech. Use museums, archives,
course catalogs, old prospectuses, field guides, liturgical calendars, book
catalogs, craft studios, and visitor guides.

For each reference return: URL, category, one transferable structural move,
and one warning about how not to copy it literally.
```

### Agent 2: IA Strategist

Prompt:

```text
Do not design visually. Do not edit files.

Given this curriculum surface, propose 5 fundamentally different information
architectures. Treat Integrated Humanities as philosophically central.

For each IA return: name, reader journey, what question it answers, what it
must omit, and what kind of skeptical parent it persuades.
```

### Agent 3: Visual Divergence Designer

Prompt:

```text
Use /ui. Do not edit files, do not produce HTML, and do not use Tailwind.

Generate 25 rough concept directions for presenting curriculum choices without
looking like a generic school curriculum page. Use the approved reference board,
selected IA, thesis sentence, and anti-brief.

Output named thumbnail concepts in words only: structure, first viewport
gesture, content rhythm, source-logo treatment, risk.
```

### Agent 4: Critic

Prompt:

```text
Do not design. Do not improve weak concepts. Kill them.

Rank the 25 concept directions against:
- distance from current page
- clarity for a skeptical parent
- fidelity to classical Christian formation
- usability on mobile
- ability to demote vendor logos without hiding sources
- fit with Trinity's existing brand without copying existing page patterns

Kill at least 15. Keep no more than 5. Recommend 3 for visual exploration.
```

## Recommended Next Move

Ask Bryant for a selection gate, not design feedback:

1. Choose 8-12 references from the board.
2. Star the 3 highest-signal references.
3. Choose IA: Formation Path, Canon and Instruments, Field Guide, Ordo,
   Prospectus, or Exhibition.
4. Choose or rewrite one thesis sentence.

Only after that should any agent produce visual concepts.
