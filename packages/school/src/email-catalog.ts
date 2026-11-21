import { db, dbReady } from './db.ts';
import { sendEmail, type EmailResult } from './email.ts';

/**
 * Every email the portal sends, in one place: what it's for, when it goes out,
 * who gets it, and its copy as a template with {{placeholders}}. Developers
 * preview and edit the copy in the developer console; edits are stored as
 * overrides (settings "email_overrides") and used by the real sends.
 *
 * A placeholder that's empty drops out cleanly: blank lines left behind are
 * collapsed, so optional parts (a staff note, an event) can sit on their own line.
 */
export const EMAIL_STAGES = [
	{ value: 'account', label: 'Account' },
	{ value: 'interest', label: 'First contact' },
	{ value: 'tours', label: 'Tours' },
	{ value: 'events', label: 'Events' },
	{ value: 'applying', label: 'Applying' },
	{ value: 'enrolled', label: 'Enrolled families' },
	{ value: 'reenrollment', label: 'Re-enrollment' },
	{ value: 'staff', label: 'Staff and access' },
] as const;
export type EmailStage = (typeof EMAIL_STAGES)[number]['value'];
export type EmailVar = { name: string; sample: string; hint: string };
export type EmailTemplate = {
	key: string; name: string; stage: EmailStage; audience: string; trigger: string;
	subject: string; body: string; vars: EmailVar[];
	/** The body is written by staff each time (announcements); only the wrapper is a template. */
	authored?: boolean;
};

const v = (name: string, sample: string, hint: string): EmailVar => ({ name, sample, hint });
const NAME = v('name', 'Rachel Brooks', 'Family or person name');
const LINK = v('link', 'https://portal.trinityclassical.academy/verify?token=…', 'A sign-in or confirmation link');
const CAMPUS = v('campus', '7160 Cahaba Valley Rd., Birmingham, AL 35242', 'The campus address');
const WHEN = v('when', 'Thursday, December 3, 2026, 8:30 AM–9:30 AM', 'Date and time');

export const EMAILS: EmailTemplate[] = [
	{ key: 'account.setup', name: 'Finish creating your account', stage: 'account', audience: 'New family', trigger: 'Someone enters their email to sign up',
		subject: 'Finish creating your TCA Portal account', body: 'Open this link to finish creating your account. It expires in 24 hours.\n\n{{link}}', vars: [LINK] },
	{ key: 'account.verify', name: 'Confirm your account', stage: 'account', audience: 'New family', trigger: 'A family signs up with a password, or signs in before confirming',
		subject: 'Confirm your Trinity family account', body: 'Hello {{name}},\n\nConfirm your family account so you can book a tour and RSVP:\n{{link}}\n\nThis link expires in two days.', vars: [NAME, LINK] },
	{ key: 'account.code', name: 'Sign-in code', stage: 'account', audience: 'Anyone signing in', trigger: 'Someone signs in with an emailed code',
		subject: 'Your TCA Portal code', body: 'Your TCA Portal code is {{code}}. It expires in 10 minutes.', vars: [v('code', '482913', 'The six-digit code')] },
	{ key: 'account.reset', name: 'Reset your password', stage: 'account', audience: 'Anyone', trigger: 'Someone asks to reset their password',
		subject: 'Reset your Trinity family password', body: 'Hello {{name}},\n\nSet a new password:\n{{link}}\n\nThis link expires in one hour. If you did not ask for this, you can ignore it.', vars: [NAME, LINK] },
	{ key: 'account.password-changed', name: 'Password changed', stage: 'account', audience: 'Every sign-in email on the account', trigger: 'A password is changed',
		subject: 'Your TCA Portal password changed', body: 'The password for your TCA Portal profile just changed. If this was not you, contact the school office.', vars: [] },
	{ key: 'account.guardian-added', name: 'Added to a family', stage: 'account', audience: 'The added parent or guardian', trigger: 'A guardian adds another person to their family',
		subject: '{{by}} added you to the {{family}} portal account', body: "Hello {{name}},\n\n{{by}} added you as a guardian on the Trinity Classical Academy portal, so you'll see the same tours, forms and school information.\n\nSet your password to sign in:\n{{link}}\n\nYou can also sign in with Google using this email. The link expires in 7 days.",
		vars: [v('name', 'Alex Brooks', 'The added person'), v('by', 'Rachel Brooks', 'Who added them'), v('family', 'Brooks family', 'Household name'), LINK] },
	{ key: 'interest.autoreply', name: 'Thanks for your interest', stage: 'interest', audience: 'Someone who filled out an interest or interview form', trigger: 'A new interest or interview request arrives (if auto-reply is on)',
		subject: 'Thanks for your interest in Trinity Classical Academy', body: "Hi {{name}},\n\nThank you for your interest in Trinity Classical Academy. We received your request.\n\n{{event}}\n\nWe will open enrollment and begin interviews no later than January, and we'll follow up then with scheduling details.\n\nTrinity Classical Academy",
		vars: [v('name', 'Daniel', 'First name'), v('event', 'Please join us for our Spring Open House on Friday, December 11 at 6:00 PM at Trinity campus. RSVP (optional): https://portal.trinityclassical.academy/rsvp/…', 'The next public event, if there is one (left out when there isn’t)')] },
	{ key: 'tour.booked', name: 'Tour booked', stage: 'tours', audience: 'Family', trigger: 'A family books a tour time',
		subject: 'Your Trinity tour time', body: 'Hello {{name}},\n\nYou are booked for a campus tour on {{when}}, for {{people}}.\n{{campus}}\n\nYou can cancel or pick a different time in the TCA Portal.', vars: [NAME, WHEN, v('people', '3 people', 'Head count'), CAMPUS] },
	{ key: 'tour.request-received', name: 'Different time requested', stage: 'tours', audience: 'Family', trigger: 'A family asks for a tour at a different time',
		subject: 'We received your tour time request', body: 'Hello {{name}},\n\nWe received your request for a tour at a different time: {{time}}.\nThe school will write back to this email.\n{{campus}}', vars: [NAME, v('time', 'Wednesday or Thursday morning', 'What they asked for'), CAMPUS] },
	{ key: 'tour.proposed', name: 'School proposes a time', stage: 'tours', audience: 'Family', trigger: 'Staff reply to a request with a proposed time',
		subject: 'A tour time to confirm', body: 'Hello {{name}},\n\nThe school proposed {{when}}.\n\n{{message}}\n\nOpen the TCA Portal to accept or decline.', vars: [NAME, WHEN, v('message', 'We have a spot that morning. Let us know!', 'Optional note from staff')] },
	{ key: 'tour.confirmed', name: 'Requested time confirmed', stage: 'tours', audience: 'Family', trigger: 'Staff confirm a requested time',
		subject: 'Your Trinity tour is confirmed', body: 'Hello {{name}},\n\nYour visit is confirmed for {{when}}.\n\n{{message}}\n{{campus}}', vars: [NAME, WHEN, v('message', 'See you then!', 'Optional note from staff'), CAMPUS] },
	{ key: 'tour.declined', name: 'Requested time declined', stage: 'tours', audience: 'Family', trigger: 'Staff decline a requested time',
		subject: 'About your tour time request', body: 'Hello {{name}},\n\nWe can’t offer {{time}}. Please pick another time in the TCA Portal, or reply to this email.', vars: [NAME, v('time', 'Saturday afternoon', 'What they asked for')] },
	{ key: 'tour.cancelled', name: 'Family cancelled a tour', stage: 'tours', audience: 'Family', trigger: 'A family cancels their tour or request',
		subject: 'Your Trinity tour request was cancelled', body: 'Hello {{name}},\n\nYour tour request {{when}} is cancelled. You can choose another time in the TCA Portal.', vars: [NAME, v('when', 'for Thursday, December 3, 8:30 AM–9:30 AM', 'When it was (may be blank)')] },
	{ key: 'tour.school-cancelled', name: 'School cancelled a tour time', stage: 'tours', audience: 'Booked families', trigger: 'Staff delete or skip a tour time someone booked',
		subject: 'A Trinity tour time was cancelled', body: 'Hello {{name}},\n\nThe school cancelled the tour on {{when}}. Please pick another time in the TCA Portal.\n{{campus}}', vars: [NAME, WHEN, CAMPUS] },
	{ key: 'event.rsvp', name: 'RSVP confirmed', stage: 'events', audience: 'Family', trigger: 'A family RSVPs to an event',
		subject: 'RSVP confirmed: {{event}}', body: 'Hello {{name}},\n\nYou are down for {{people}} at {{event}}.\n\nYou can change the head count in the family portal.', vars: [NAME, v('event', 'Spring Open House', 'Event title'), v('people', '4', 'Head count')] },
	{ key: 'event.cancelled', name: 'Event cancelled', stage: 'events', audience: 'Families who RSVPed', trigger: 'Staff delete an event',
		subject: '{{event}} was cancelled', body: 'The school cancelled {{event}}.', vars: [v('event', 'Spring Open House', 'Event title')] },
	{ key: 'interview.invite', name: 'Choose an interview time', stage: 'applying', audience: 'Applying family', trigger: 'Staff move an application to Interview',
		subject: 'Choose a time for your Trinity interview', body: "Hello {{name}},\n\nThank you for your interest in Trinity Classical Academy. We'd love to meet your family. Please sign in to the TCA Portal and choose an interview time on the Apply page.\n\n{{link}}", vars: [NAME, v('link', 'https://portal.trinityclassical.academy/applications', 'The Apply page')] },
	{ key: 'interview.booked', name: 'Interview booked', stage: 'applying', audience: 'Applying family', trigger: 'A family books an interview time',
		subject: 'Your Trinity interview time', body: 'Hello {{name}},\n\nYour interview with Trinity Classical Academy is on {{when}}.\n{{campus}}\n\nYou can change or cancel it on the Apply page in the TCA Portal.', vars: [NAME, v('when', 'Thursday, December 3, 2026, 4:00 PM–4:45 PM', 'Date and time'), CAMPUS] },
	{ key: 'announcement', name: 'Announcement', stage: 'enrolled', audience: 'Enrolled families', trigger: 'Staff publish an announcement with “Email it” on', authored: true,
		subject: '{{title}}', body: '{{body}}\n\n{{audience}}', vars: [v('title', 'Friday recitation and chapel', 'Written by staff'), v('body', 'We look forward to learning together. Please check the family calendar for upcoming dates.', 'Written by staff'), v('audience', 'For all families', 'Who it was sent to')] },
	{ key: 'document.new', name: 'New document', stage: 'enrolled', audience: 'Enrolled families', trigger: 'Staff publish a document with “Email families” on',
		subject: 'New document: {{title}}', body: '{{title}} is in your TCA Portal documents.', vars: [v('title', 'Winter newsletter', 'Document title')] },
	{ key: 'form.reminder', name: 'Form reminder', stage: 'enrolled', audience: 'Families who haven’t submitted', trigger: 'Staff press Remind on a form',
		subject: 'Form still needed: {{title}}', body: 'Please finish {{title}}{{due}} in the TCA Portal.', vars: [v('title', 'Photo permission', 'Form title'), v('due', ' by December 4, 2026', 'Due date (blank when none)')] },
	{ key: 'reenrollment.open', name: 'Re-enrollment is open', stage: 'reenrollment', audience: 'Families with a child enrolled now', trigger: 'Staff open re-enrollment',
		subject: 'Re-enrollment for {{year}} is open', body: 'Hello,\n\nRe-enrollment for the {{year}} school year is open. Please let us know by {{deadline}} whether {{children}} will be returning.\n\nIt takes a minute in the TCA Portal: {{link}}',
		vars: [v('year', '2027–28', 'Next school year'), v('deadline', 'February 15', 'Answer-by date'), v('children', 'Amelia and Oliver', 'First names'), v('link', 'https://portal.trinityclassical.academy/g/students', 'Students page')] },
	{ key: 'reenrollment.reminder', name: 'Re-enrollment reminder', stage: 'reenrollment', audience: 'Families who haven’t answered', trigger: 'Staff press Remind on Re-enrollment',
		subject: 'Reminder: is {{children}} returning for {{year}}?', body: "Hello,\n\nWe haven't heard yet whether {{children}} will be returning for {{year}}. {{deadline}}\n\n{{link}}",
		vars: [v('children', 'Amelia and Oliver', 'First names'), v('year', '2027–28', 'Next school year'), v('deadline', 'Please let us know by February 15.', 'Deadline sentence (blank when none)'), v('link', 'https://portal.trinityclassical.academy/g/students', 'Students page')] },
	{ key: 'access.granted', name: 'Access added', stage: 'staff', audience: 'Staff, admins, developers', trigger: 'An admin adds or grants access on Staff & access',
		subject: '{{roles}} access on TCA Portal', body: '{{roles}} access was added to your TCA Portal account. {{signin}}\n\n{{link}}', vars: [v('roles', 'Staff', 'What was added'), v('signin', 'Sign in to see it in the sidebar.', 'Sign-in hint'), v('link', 'https://portal.trinityclassical.academy', 'Portal address')] },
];

export const emailTemplate = (key: string) => EMAILS.find((item) => item.key === key);

export type EmailOverride = { subject?: string; body?: string; updatedAt: string; updatedBy: string };
const OVERRIDES = 'email_overrides';

export async function emailOverrides(): Promise<Record<string, EmailOverride>> {
	await dbReady();
	const [row] = await db()`select value from settings where key = ${OVERRIDES}`;
	return (row?.value as Record<string, EmailOverride>) ?? {};
}

/** Fill {{placeholders}}; unknown ones are left visible so a typo shows in the preview. */
export function fillTemplate(template: string, vars: Record<string, string | number | undefined>): string {
	return template.replace(/\{\{\s*([a-z]+)\s*\}\}/gi, (match, name: string) => name in vars ? String(vars[name] ?? '') : match)
		.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** The subject and text for one email, using any saved edits. */
export async function renderEmail(key: string, vars: Record<string, string | number | undefined>, overrides?: Record<string, EmailOverride>): Promise<{ subject: string; text: string }> {
	const template = emailTemplate(key);
	if (!template) throw new Error(`Unknown email: ${key}`);
	const edit = (overrides ?? await emailOverrides())[key];
	return { subject: fillTemplate(edit?.subject ?? template.subject, vars).replace(/\s+/g, ' '), text: `${fillTemplate(edit?.body ?? template.body, vars)}\n` };
}

/** Render and send one catalog email. */
export async function sendTemplate(key: string, to: string, vars: Record<string, string | number | undefined>, replyTo?: string): Promise<EmailResult> {
	return sendEmail({ to, ...(await renderEmail(key, vars)), ...(replyTo ? { replyTo } : {}) });
}

/** Save edited copy for one email (an empty field keeps the default). */
export async function saveEmailOverride(key: string, input: { subject: string; body: string }, by: string): Promise<{ ok: true } | { ok: false; error: string }> {
	await dbReady();
	const template = emailTemplate(key);
	if (!template) return { ok: false, error: 'Unknown email.' };
	const subject = input.subject.trim(), body = input.body.replace(/\r\n/g, '\n').trim();
	if (!subject || !body) return { ok: false, error: 'Subject and body can’t be empty.' };
	const known = new Set(template.vars.map((item) => item.name));
	const unknown = [...`${subject}\n${body}`.matchAll(/\{\{\s*([a-z]+)\s*\}\}/gi)].map((match) => match[1]).filter((name) => !known.has(name));
	if (unknown.length) return { ok: false, error: `Unknown placeholder: {{${unknown[0]}}}. Use one of the listed placeholders.` };
	const all = await emailOverrides();
	all[key] = { ...(subject !== template.subject ? { subject } : {}), ...(body !== template.body ? { body } : {}), updatedAt: new Date().toISOString(), updatedBy: by };
	if (!all[key].subject && !all[key].body) delete all[key];
	await db()`insert into settings (key, value) values (${OVERRIDES}, ${db().json(all)}) on conflict (key) do update set value = excluded.value`;
	return { ok: true };
}

export async function resetEmailOverride(key: string): Promise<void> {
	await dbReady();
	const all = await emailOverrides();
	delete all[key];
	await db()`insert into settings (key, value) values (${OVERRIDES}, ${db().json(all)}) on conflict (key) do update set value = excluded.value`;
}
