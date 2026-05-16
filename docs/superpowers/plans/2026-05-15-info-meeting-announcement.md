# Info Meeting Announcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a homepage event strip that opens the informational meeting flyer in a flyer-only modal.

**Architecture:** Implement one focused Astro component that owns the strip, flyer lightbox, and client-side open/close behavior. Mount it only on the homepage before the existing sticky header so it is prominent on load and scrolls away naturally.

**Tech Stack:** Astro 6, Tailwind CSS 4 utility classes, vanilla inline browser JavaScript.

---

## File Structure

- `src/components/InfoMeetingAnnouncement.astro` — new self-contained announcement strip, flyer lightbox, and modal script.
- `src/pages/index.astro` — import and mount the announcement component before `<Header />`.
- `public/events/tca-info-meeting-june-4.png` — local copy of the flyer attachment.

## Task 1: Add Flyer Asset

**Files:**
- Create: `public/events/tca-info-meeting-june-4.png`

- [ ] **Step 1: Create the public events directory**

Run:

```bash
mkdir -p public/events
```

Expected: `public/events` exists.

- [ ] **Step 2: Copy the flyer attachment into the public asset path**

Run:

```bash
cp /tmp/tca-info-meeting/image0.png public/events/tca-info-meeting-june-4.png
```

Expected: `public/events/tca-info-meeting-june-4.png` exists and is a PNG.

- [ ] **Step 3: Verify dimensions**

Run:

```bash
file public/events/tca-info-meeting-june-4.png
```

Expected: output includes `PNG image data, 1024 x 1535`.

## Task 2: Build `InfoMeetingAnnouncement.astro`

**Files:**
- Create: `src/components/InfoMeetingAnnouncement.astro`

- [ ] **Step 1: Create component markup**

Add an Astro component with:

- A dark green announcement strip with `Upcoming informational meeting night`, `Thursday, June 4, 2026 at 6:30 PM · Trinity Presbyterian Church`, and a `View flyer` button.
- A hidden modal using `role="dialog"`, `aria-modal="true"`, and an accessible close button.
- A flyer image sourced from `/events/tca-info-meeting-june-4.png`.
- No RSVP form or detail column.

- [ ] **Step 2: Add client behavior**

In the same component, add an inline script that:

- Opens the modal from `[data-info-meeting-trigger]`.
- Closes via close button, backdrop click, and Escape.
- Stores and restores the triggering element focus.
- Locks body scroll while open.

## Task 3: Mount On Homepage

**Files:**
- Modify: `src/pages/index.astro`

- [ ] **Step 1: Import the component**

Add:

```astro
import InfoMeetingAnnouncement from '../components/InfoMeetingAnnouncement.astro';
```

- [ ] **Step 2: Mount before the header**

Add:

```astro
<InfoMeetingAnnouncement />
<Header />
```

Expected: The strip appears above the sticky header only on the homepage.

## Task 4: Verify Build And Markup

**Files:**
- Validate generated `dist/index.html`

- [ ] **Step 1: Build with Node 24**

Run:

```bash
/Users/bryantbrock/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/astro/bin/astro.mjs build
```

Expected: build completes successfully.

- [ ] **Step 2: Confirm flyer-only markup**

Run:

```bash
rg -n "View flyer|data-info-meeting-modal|tca-info-meeting-june-4.png" dist/index.html
! rg -n "info-meeting-rsvp|party_size|data-info-meeting-form" dist/index.html
```

Expected: output includes the flyer modal selectors and no RSVP form markup.

## Task 5: Browser QA

**Files:**
- Validate local rendered homepage.

- [ ] **Step 1: Start the dev server**

Run:

```bash
/Users/bryantbrock/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/astro/astro.js dev --host 127.0.0.1
```

If that entrypoint is unavailable, run:

```bash
PATH="/Users/bryantbrock/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" npm run dev -- --host 127.0.0.1
```

Expected: Astro dev server starts and prints a localhost URL.

- [ ] **Step 2: Capture desktop and mobile screenshots**

Use browser automation to verify:

- Announcement strip is visible above the header.
- Modal opens from `View flyer`.
- Flyer is visible.
- RSVP form fields are absent.
- Modal closes with Escape or the close button.

Expected: screenshots show no obvious overlap or unreadable text.

## Task 6: Commit Implementation

**Files:**
- Stage only implementation files and this plan.

- [ ] **Step 1: Review diff**

Run:

```bash
git diff -- src/components/InfoMeetingAnnouncement.astro src/pages/index.astro docs/superpowers/plans/2026-05-15-info-meeting-announcement.md
git status --short
```

Expected: diff contains only planned changes and the flyer asset.

- [ ] **Step 2: Commit**

Run:

```bash
git add src/components/InfoMeetingAnnouncement.astro src/pages/index.astro public/events/tca-info-meeting-june-4.png docs/superpowers/plans/2026-05-15-info-meeting-announcement.md
git commit -m "feat: add info meeting announcement"
```

Expected: commit succeeds on `codex/info-meeting-announcement`.
