import { db, dbReady } from './db.ts';
import { portalOrigin, sendEmail, staffNotifyEmail } from './email.ts';
import { eventClock, eventDate } from './time.ts';
import { emailOverrides, renderEmail } from './email-catalog.ts';

export type ReplyEvent = { id: string; title: string; startsAt: string; location: string; rsvpUrl: string };

/** The optional paragraph inviting them to the next public event. */
function eventLine(event: ReplyEvent, origin: string): string {
	return `Please join us for our ${event.title} on ${eventDate(event.startsAt, false)} at ${eventClock(event.startsAt)} at ${event.location}. RSVP (optional): ${event.rsvpUrl || `${origin.replace(/\/$/, '')}/rsvp/${event.id}`}`;
}

export function inquiryAutoReply(input: { firstName?: string; event?: ReplyEvent | null; portalOrigin: string }) {
	const name = input.firstName?.trim() || 'there';
	const event = input.event;
	const paragraphs = [
		`Hi ${name},`,
		'Thank you for your interest in Trinity Classical Academy. We received your request.',
	];
	if (event) paragraphs.push(eventLine(event, input.portalOrigin));
	paragraphs.push("We will open enrollment and begin interviews no later than January, and we'll follow up then with scheduling details.", 'Trinity Classical Academy');
	return { subject: 'Thanks for your interest in Trinity Classical Academy', text: paragraphs.join('\n\n') + '\n' };
}

export async function nextInquiryEvent(): Promise<ReplyEvent | null> {
	await dbReady();
	const [row] = await db()`select id, title, starts_at, location, rsvp_url from events
		where show_on_website and collect_rsvp and starts_at > now() order by starts_at limit 1`;
	return row ? { id: String(row.id), title: String(row.title), startsAt: new Date(row.starts_at).toISOString(), location: String(row.location), rsvpUrl: String(row.rsvp_url) } : null;
}

export async function inquiryAutoReplyEnabled(): Promise<boolean> {
	await dbReady();
	const [row] = await db()`select value from settings where key = 'inquiry_autoreply_enabled'`;
	return row?.value === true;
}

/**
 * Only public inquiry sources qualify. Claiming the row (setting autoreply_sent_at) makes duplicate calls
 * send once. The send runs outside any transaction: rendering and sendEmail read and log through the same
 * single database connection, which a held transaction would block forever. A failed send clears the claim.
 */
export async function sendInquiryAutoReply(id: string, deliver = sendEmail): Promise<void> {
	if (process.env.INQUIRY_AUTOREPLY === 'off' || !await inquiryAutoReplyEnabled()) return;
	const event = await nextInquiryEvent();
	const overrides = await emailOverrides();
	const [row] = await db()`update inquiries set autoreply_sent_at = now()
		where id = ${id} and autoreply_sent_at is null and source in ('interview', 'interested')
		returning email, name, details`;
	if (!row) return;
	let delivered = false;
	try {
		const firstName = row.details?.firstName || String(row.name || '').trim().split(/\s+/)[0];
		// Copy comes from the email catalog (so edits in the developer console apply).
		const result = await deliver({ to: row.email, replyTo: staffNotifyEmail(), template: 'interest.autoreply', ...await renderEmail('interest.autoreply', { name: String(firstName || '').trim() || 'there', event: event ? eventLine(event, portalOrigin()) : '' }, overrides) });
		delivered = result.delivered;
	} finally {
		// Nobody else can claim it meanwhile, so the mark is ours to clear.
		if (!delivered) await db()`update inquiries set autoreply_sent_at = null where id = ${id}`;
	}
}
