# Informational meeting announcement — design

**Date:** 2026-05-15
**Status:** Approved (pending user spec review)
**Author:** Brainstormed with Codex

## Problem

Trinity Classical Academy has a digital flyer for an upcoming informational meeting and needs a prominent but tasteful way to display it on the landing page. The announcement should make the meeting visible immediately, let visitors view the full flyer, and optionally RSVP without making the RSVP feel like registration.

The source email attachment is `image0.png`, a tall 1024 x 1535 PNG flyer. It announces:

- **Event:** Informational Meeting
- **Date:** Thursday, June 4, 2026
- **Time:** 6:30 PM
- **Location:** Trinity Presbyterian Church, 7160 Cahaba Valley Road, Birmingham, AL 35242

## Goals

- Add a compact, dark-green announcement strip at the top of the homepage.
- Display the flyer in a modal/lightbox from the announcement strip.
- Include a lightweight RSVP form that is optional to submit, with required fields only after a visitor chooses to RSVP.
- Preserve the landing page's current editorial feel and existing header behavior.
- Reuse the site's existing Netlify Forms and modal patterns where practical.

## Non-goals

- Calendar invitations or event reminders.
- Required registration, ticketing, capacity management, or check-in.
- CRM/email-platform sync.
- Showing the event announcement on every page.
- Reworking the existing newsletter modal or global header architecture beyond what this feature needs.

## Selected approach

Use **B: Compact Event Strip**.

The homepage gets a slim event strip above the sticky header. It uses the existing dark green palette with a gold accent and compact typography:

- Eyebrow: `Upcoming informational meeting night`
- Detail: `Thursday, June 4, 2026 at 6:30 PM · Trinity Presbyterian Church`
- CTA: `View flyer & RSVP`

On desktop, the strip reads as event text on the left and a CTA on the right. On mobile, it stacks into two tight rows so the date and action remain readable.

The strip remains in normal document flow. It is visible at the top of the page on load, then scrolls away. The existing sticky header keeps its current behavior and pins to the top once the page scrolls.

## Components

### `InfoMeetingAnnouncement.astro`

Create a dedicated component that owns:

- The announcement strip.
- The modal/lightbox markup.
- The hidden Netlify-detectable RSVP form.
- The client-side open/close/submission script.

Mount the component only on the homepage, immediately before `<Header />`, so the announcement appears at the very top of the landing page and does not affect interior pages.

Use dedicated attributes such as `data-info-meeting-modal`, `data-info-meeting-trigger`, and `data-info-meeting-form` to avoid collisions with the existing newsletter modal.

### Flyer asset

Save the email attachment as a local public asset, for example:

`public/events/tca-info-meeting-june-4.png`

The implementation may optimize the asset size if needed, but it should not visually redesign the flyer.

## Modal design

The modal opens from the announcement strip and treats the flyer as the primary content.

Desktop layout:

- Left side: the flyer in a tall poster frame.
- Right side: event details, RSVP form, success/error states, and a simple secondary link to open the flyer in a new tab.

Mobile layout:

- Full-screen sheet.
- Flyer appears first in a scrollable poster area.
- Event details and RSVP form follow below.
- Close control remains easy to reach.
- The flyer can open in a new tab for native pinch/zoom.

The modal should be visually related to the existing newsletter modal: white surface, 8px radius, restrained border, and no decorative card nesting.

## RSVP form

Form name: `info-meeting-rsvp`

Fields:

- `name` — required text input.
- `email` — required email input.
- `party_size` — required select with options `1`, `2`, `3`, `4`, `5`, and `6+`.

Copy should frame the RSVP as optional:

`Let us know if you're coming. This is not required, but it helps us plan.`

Success state:

`Thanks, we'll look forward to seeing you.`

Error state:

Show an inline message and re-enable the form. Do not hide the flyer or close the modal on error.

## Data flow

Submissions use Netlify Forms, matching the contact and newsletter patterns already in the codebase:

1. The visible RSVP form posts to `/`.
2. The request uses `Content-Type: application/x-www-form-urlencoded`.
3. Netlify captures the submission under `info-meeting-rsvp`.
4. The modal transitions to success after a successful response.

No persistent client-side state is needed. Unlike the newsletter popup, this event modal should not use localStorage.

## Accessibility

- The CTA is a `<button>` because it opens a dialog.
- The modal uses `role="dialog"` and `aria-modal="true"`.
- The dialog has a labelled heading.
- Escape closes the modal.
- Backdrop click closes the modal.
- The close control is a real button with an accessible label.
- Opening the modal stores the triggering element and returns focus to it on close.
- Body scroll is locked while the modal is open.
- The flyer image has descriptive alt text.

## Edge cases

- If JavaScript fails, the hidden Netlify form still exists for build-time detection, but the modal interaction will not work. This matches the existing newsletter modal tradeoff.
- If the flyer is too tall for the viewport, the modal content scrolls without clipping the close button.
- If the RSVP request fails, the form remains filled and the visitor can retry.
- The newsletter modal and the event modal must operate independently.

## Files touched

New:

- `src/components/InfoMeetingAnnouncement.astro`
- `public/events/tca-info-meeting-june-4.png`

Edited:

- `src/pages/index.astro` — mount the announcement component before `<Header />`.

No planned changes:

- `src/layouts/Layout.astro`
- `src/components/Header.astro`
- `src/components/NewsletterSignup.astro`
- `src/lib/links.ts`

## Testing plan

- Run the project build.
- Verify Netlify form detection includes `info-meeting-rsvp`.
- Verify the announcement strip at desktop and mobile widths.
- Verify modal open/close via CTA, close button, Escape, and backdrop.
- Verify focus returns to the announcement CTA after close.
- Verify flyer display on desktop and mobile, including the new-tab link.
- Verify RSVP success state with a normal submission path.
- Simulate a failed RSVP submission and verify the inline error state.
- Verify the newsletter modal still opens and submits independently.

## Approved decisions

- Use the compact event strip placement.
- Show the flyer in a modal/lightbox.
- Include a non-required RSVP experience.
- Collect name, email, and number attending.
- Keep the strip homepage-only and allow it to scroll away.
