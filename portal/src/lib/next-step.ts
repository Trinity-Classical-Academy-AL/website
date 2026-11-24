import { chicagoToday, incomingDate, type Application, type IncomingRow } from '@tca/school';
import type { DirectoryFamily } from './pages/families.ts';

/**
 * The one thing the office should do next for a prospective family, worked out
 * from what the portal already knows: their inquiries, tour request, application
 * stage and interview booking. The family sheet shows it as a card with one main
 * button; the Families list shows its short label so the office can work down it.
 */
export type StepAction =
	| { kind: 'link'; label: string; href: string; external?: boolean }
	| { kind: 'post'; label: string; action: string; fields: Record<string, string | string[]>; confirm?: string; confirmYes?: string; danger?: boolean };
export type NextStep = {
	/** Short label for the list and its filter. */
	key: StepKey;
	title: string;
	detail: string;
	tone: 'act' | 'wait' | 'done';
	primary?: StepAction;
	secondary?: StepAction;
	/** The inquiry this step is about: only it shows "Needs reply" on the timeline. */
	inquiryId?: string;
};
export const STEP_KEYS = [
	{ value: 'reply', label: 'Reply' },
	{ value: 'propose', label: 'Propose a tour time' },
	{ value: 'invite', label: 'Invite to interview' },
	{ value: 'decide', label: 'Decide after interview' },
	{ value: 'review', label: 'Review application' },
	{ value: 'resend', label: 'Waiting on ClassReach' },
	{ value: 'followup', label: 'Follow up' },
	{ value: 'hiring', label: 'Move to Hiring' },
	{ value: 'waiting', label: 'Waiting on family' },
	{ value: 'none', label: 'Nothing to do' },
] as const;
export type StepKey = (typeof STEP_KEYS)[number]['value'];
export const ACTION_KEYS: StepKey[] = ['reply', 'propose', 'invite', 'decide', 'review', 'followup', 'hiring'];
export const stepLabel = (key: StepKey) => STEP_KEYS.find((item) => item.value === key)?.label ?? '';

const DAY = 86400000;
const first = (name: string) => name.trim().split(/\s+/)[0] || 'there';
/** A starter reply the admin edits in their own email. */
const replyLink = (row: DirectoryFamily, followUp = false) => {
	const subject = followUp ? 'Following up from Trinity Classical Academy' : 'Thank you for reaching out to Trinity Classical Academy';
	const body = followUp
		? `Hi ${first(row.name)},\n\nI wanted to follow up on your interest in Trinity Classical Academy. Is there anything I can answer, or a time that works for a tour or a quick call?\n\n`
		: `Hi ${first(row.name)},\n\nThank you for reaching out to Trinity Classical Academy. \n\n`;
	return `mailto:${encodeURIComponent(row.emails[0])}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
};
const openApp = (apps: Application[]) => apps.filter((app) => app.status !== 'declined' && app.status !== 'withdrawn').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

/**
 * `interview`: the family's booked interview date (YYYY-MM-DD) and when, if any.
 * Most urgent first: a teaching inquiry, then the application's stage, a tour
 * request, unanswered inquiries, a quiet family, then nothing.
 */
export function nextStep(row: DirectoryFamily, interview: { date: string; when: string } | null = null, now = Date.now(), today = chicagoToday()): NextStep {
	const open = row.inquiries.filter((inquiry) => inquiry.status === 'new');
	const replied = { kind: 'post' as const, label: 'Mark replied', action: 'contacted', fields: { id: open.map((inquiry) => inquiry.id) } };

	const teaching = open.find((inquiry) => inquiry.contactType === 'teaching');
	if (teaching) return {
		key: 'hiring', tone: 'act', inquiryId: teaching.id,
		title: 'This is about teaching',
		detail: `${first(row.name || 'They')} asked about teaching at Trinity. Move them to Hiring, where candidates apply and are reviewed.`,
		primary: { kind: 'post', label: 'Move to Hiring', action: 'to-hiring', fields: { id: teaching.id }, confirm: 'Add them to Hiring as a candidate? They aren’t emailed.', confirmYes: 'Move to Hiring' },
	};

	if (row.stage === 'enrolled') return { key: 'none', tone: 'done', title: 'Enrolled', detail: 'Nothing to do here.' };

	const app = openApp(row.applications);
	if (app) {
		// Acting on the application answers the family's open inquiries too (an interview request is answered by the invitation).
		const status = (value: string, label: string, confirm?: string, danger = false): StepAction => ({ kind: 'post', label, action: 'app-status', fields: { id: app.id, status: value, inquiry: open.map((inquiry) => inquiry.id) }, confirm, confirmYes: label, danger });
		if (app.status === 'accepted') return {
			key: 'resend', tone: 'wait',
			title: 'Accepted. Waiting for their ClassReach account',
			detail: 'They were emailed the ClassReach sign-up link. Once they finish, they show as enrolled.',
			primary: { kind: 'post', label: 'Resend the link', action: 'resend-classreach', fields: { id: app.id }, confirm: 'Email them the ClassReach sign-up link again?', confirmYes: 'Resend' },
		};
		if (app.status === 'application_submitted') return {
			key: 'review', tone: 'act',
			title: 'Full application in. Review it',
			detail: 'Read their full application, then accept them (which sends the ClassReach link) or decline.',
			primary: { kind: 'link', label: 'Review application', href: `/admin/applications?app=${app.id}` },
		};
		if (app.status === 'approved') return {
			key: 'waiting', tone: 'wait',
			title: 'Approved. Waiting for their full application',
			detail: app.fullApplication ? (app.fullApplication.status === 'draft' ? 'They’ve started it.' : 'They have it in the portal but haven’t started.') : 'Publish a Full application form (Documents & forms) so they get it.',
			primary: { kind: 'link', label: 'Open application', href: `/admin/applications?app=${app.id}` },
		};
		if (app.status === 'interview') {
			if (interview && interview.date < today) return {
				key: 'decide', tone: 'act',
				title: `Interviewed ${interview.when}. Decide`,
				detail: 'Approve to send their full application, or let them know it isn’t a fit.',
				primary: status('approved', 'Approve', 'Approve them? We email them the full application.'),
				secondary: status('declined', 'Not a fit', 'Mark them not approved? We email them a kind note.', true),
			};
			if (interview) return { key: 'waiting', tone: 'wait', title: `Interview ${interview.when}`, detail: 'After the interview, come back here to approve or decline.' };
			return { key: 'waiting', tone: 'wait', title: 'Invited to interview', detail: 'They were emailed to pick an interview time. Nothing to do until they book.' };
		}
		if (app.status === 'requested') return {
			key: 'invite', tone: 'act',
			title: 'Requested an interview',
			detail: `Invite them to book one of the posted interview times.${app.children.length ? ` For ${app.children.map((child) => child.name).join(', ')}.` : ''}`,
			primary: status('interview', 'Invite to interview', 'Invite them to interview? We email them a link to pick a time.'),
			secondary: status('declined', 'Not a fit', 'Mark them not approved? We email them a kind note.', true),
		};
	}

	if (row.tour === 'Time requested') return {
		key: 'propose', tone: 'act',
		title: 'Asked for a tour time',
		detail: 'They asked for a tour at a time we don’t offer. Propose one that works.',
		primary: { kind: 'link', label: 'Propose a time', href: '/admin/calendar/rsvps' },
	};

	if (open.length) {
		const newest = open[0];
		return {
			key: 'reply', tone: 'act', inquiryId: newest.id,
			title: open.length > 1 ? `${open.length} messages to answer` : 'Asked a question',
			detail: `${newest.message ? `“${newest.message.slice(0, 140)}${newest.message.length > 140 ? '…' : ''}”` : 'They reached out.'} Reply by email, then mark it replied.`,
			primary: { kind: 'link', label: 'Reply by email', href: replyLink(row), external: true },
			secondary: replied,
		};
	}

	if (row.tour.startsWith('Booked')) return { key: 'waiting', tone: 'wait', title: row.tour === 'Booked' ? 'Tour booked' : `Tour booked: ${row.tour.replace(/^Booked\s*/, '')}`, detail: 'Nothing to do until the tour.' };

	const last = row.inquiries.filter((inquiry: IncomingRow) => inquiry.contactedAt).sort((a, b) => Date.parse(b.contactedAt!) - Date.parse(a.contactedAt!))[0];
	if (last && row.stage !== 'updates' && now - Date.parse(last.contactedAt!) >= 14 * DAY && now - Date.parse(row.lastAt) >= 14 * DAY) return {
		key: 'followup', tone: 'act',
		title: `No reply since ${incomingDate(last.contactedAt!)}`,
		detail: 'Check in once more by email.',
		primary: { kind: 'link', label: 'Follow up', href: replyLink(row, true), external: true },
		secondary: { kind: 'post', label: 'Mark followed up', action: 'contacted', fields: { id: last.id } },
	};

	if (row.stage === 'updates') return { key: 'none', tone: 'done', title: 'On the updates list', detail: 'Nothing to do. They get school updates by email.' };
	return { key: 'none', tone: 'done', title: 'Nothing to do right now', detail: 'They’ll show here again when they reach out, book a tour or apply.' };
}
