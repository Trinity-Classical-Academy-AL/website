# Informational meeting announcement — design

**Date:** 2026-05-15
**Status:** Approved (pending user spec review)
**Author:** Brainstormed with Codex

## Problem

Trinity Classical Academy has a digital flyer for an upcoming informational meeting and needs a prominent but tasteful way to display it on the landing page. The announcement should make the meeting visible immediately and let visitors view the full flyer without adding a separate registration flow.

The source email attachment is `image0.png`, a tall 1024 x 1535 PNG flyer. It announces:

- **Event:** Informational Meeting
- **Date:** Thursday, June 4, 2026
- **Time:** 6:30 PM
- **Location:** Trinity Presbyterian Church, 7160 Cahaba Valley Road, Birmingham, AL 35242

## Goals

- Add a compact, dark-green announcement strip at the top of the homepage.
- Display the flyer in a modal/lightbox from the announcement strip.
- Keep the modal focused on the flyer only.
- Preserve the landing page's current editorial feel and existing header behavior.
- Reuse the site's existing Netlify Forms and modal patterns where practical.

## Non-goals

- Calendar invitations or event reminders.
- RSVP, registration, ticketing, capacity management, or check-in.
- CRM/email-platform sync.
- Showing the event announcement on every page.
- Reworking the existing newsletter modal or global header architecture beyond what this feature needs.

## Selected approach

Use **B: Compact Event Strip**.

The homepage gets a slim event strip above the sticky header. It uses the existing dark green palette with a gold accent and compact typography:

- Eyebrow: `Upcoming informational meeting night`
- Detail: `Thursday, June 4, 2026 at 6:30 PM · Trinity Presbyterian Church`
- CTA: `View flyer`

On desktop, the strip reads as event text on the left and a CTA on the right. On mobile, it stacks into two tight rows so the date and action remain readable.

The strip remains in normal document flow. It is visible at the top of the page on load, then scrolls away. The existing sticky header keeps its current behavior and pins to the top once the page scrolls.

## Components

### `InfoMeetingAnnouncement.astro`

Create a dedicated component that owns:

- The announcement strip.
- The modal/lightbox markup.
- The client-side open/close script.

Mount the component only on the homepage, immediately before `<Header />`, so the announcement appears at the very top of the landing page and does not affect interior pages.

Use dedicated attributes such as `data-info-meeting-modal` and `data-info-meeting-trigger` to avoid collisions with the existing newsletter modal.

### Flyer asset

Save the email attachment as a local public asset, for example:

`public/events/tca-info-meeting-june-4.png`

The implementation may optimize the asset size if needed, but it should not visually redesign the flyer.

## Modal design

The modal opens from the announcement strip and shows only the flyer.

Desktop layout:

- The flyer is centered in a dark green lightbox.
- The image scales proportionally to the available viewport using `object-contain`.
- No detail column, RSVP form, or secondary content appears in the modal.

Mobile layout:

- Full-screen lightbox.
- Flyer scales proportionally to fit the viewport width and height.
- Close control remains easy to reach.

The modal should feel like a simple image viewer: dark backdrop, restrained border, 8px radius on larger screens, and no decorative card nesting.

## Data flow

No form submission or persistent client-side state is needed. Unlike the newsletter popup, this event modal should not use localStorage.

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
- If the flyer is too tall for the viewport, the image scales down proportionally rather than requiring a separate detail column.
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
- Verify the announcement strip at desktop and mobile widths.
- Verify modal open/close via CTA, close button, Escape, and backdrop.
- Verify focus returns to the announcement CTA after close.
- Verify flyer display on desktop and mobile.
- Verify the newsletter modal still opens and submits independently.

## Approved decisions

- Use the compact event strip placement.
- Show the flyer in a modal/lightbox.
- Remove the RSVP experience.
- Keep the modal flyer-only.
- Keep the strip homepage-only and allow it to scroll away.
