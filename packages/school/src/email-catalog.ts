import { db, dbReady } from './db.ts';
import { portalOrigin, sendEmail, type EmailResult } from './email.ts';

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
	{ key: 'account.code', name: 'Confirm an added email', stage: 'account', audience: 'The new email address', trigger: 'Someone adds another sign-in email in Account settings',
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
		subject: 'Your Trinity tour time', body: 'Hello {{name}},\n\nYou are booked for a campus tour on {{when}}, for {{people}}.\n{{campus}}\n\nNeed to change it? You can cancel or pick a different time here:\n\n{{link}}', vars: [NAME, WHEN, v('people', '3 people', 'Head count'), CAMPUS, v('link', 'https://portal.trinityclassical.academy/tour', 'Request a tour page')] },
	{ key: 'tour.request-received', name: 'Different time requested', stage: 'tours', audience: 'Family', trigger: 'A family asks for a tour at a different time',
		subject: 'We received your tour time request', body: 'Hello {{name}},\n\nWe received your request for a tour at a different time: {{time}}.\nThe school will write back to this email.\n{{campus}}', vars: [NAME, v('time', 'Wednesday or Thursday morning', 'What they asked for'), CAMPUS] },
	{ key: 'tour.proposed', name: 'School proposes a time', stage: 'tours', audience: 'Family', trigger: 'Staff reply to a request with a proposed time',
		subject: 'A tour time to confirm', body: 'Hello {{name}},\n\nThe school proposed {{when}}.\n\n{{message}}\n\nAccept it or ask for another time here:\n\n{{link}}', vars: [NAME, WHEN, v('message', 'We have a spot that morning. Let us know!', 'Optional note from staff'), v('link', 'https://portal.trinityclassical.academy/tour', 'Where they accept or decline')] },
	{ key: 'tour.confirmed', name: 'Requested time confirmed', stage: 'tours', audience: 'Family', trigger: 'Staff confirm a requested time',
		subject: 'Your Trinity tour is confirmed', body: 'Hello {{name}},\n\nYour visit is confirmed for {{when}}.\n\n{{message}}\n{{campus}}', vars: [NAME, WHEN, v('message', 'See you then!', 'Optional note from staff'), CAMPUS] },
	{ key: 'tour.declined', name: 'Requested time declined', stage: 'tours', audience: 'Family', trigger: 'Staff decline a requested time',
		subject: 'About your tour time request', body: 'Hello {{name}},\n\nWe can’t offer {{time}}. Please pick another time, or reply to this email.\n\n{{link}}', vars: [NAME, v('time', 'Saturday afternoon', 'What they asked for'), v('link', 'https://portal.trinityclassical.academy/tour', 'Request a tour page')] },
	{ key: 'tour.cancelled', name: 'Family cancelled a tour', stage: 'tours', audience: 'Family', trigger: 'A family cancels their tour or request',
		subject: 'Your Trinity tour request was cancelled', body: 'Hello {{name}},\n\nYour tour request {{when}} is cancelled. You can choose another time whenever you’re ready:\n\n{{link}}', vars: [NAME, v('when', 'for Thursday, December 3, 8:30 AM–9:30 AM', 'When it was (may be blank)'), v('link', 'https://portal.trinityclassical.academy/tour', 'Request a tour page')] },
	{ key: 'tour.school-cancelled', name: 'School cancelled a tour time', stage: 'tours', audience: 'Booked families', trigger: 'Staff delete or skip a tour time someone booked',
		subject: 'A Trinity tour time was cancelled', body: 'Hello {{name}},\n\nThe school cancelled the tour on {{when}}. We’re sorry for the change. Please pick another time:\n\n{{link}}', vars: [NAME, WHEN, v('link', 'https://portal.trinityclassical.academy/tour', 'Request a tour page')] },
	{ key: 'event.rsvp', name: 'RSVP confirmed', stage: 'events', audience: 'Family', trigger: 'A family RSVPs to an event',
		subject: 'RSVP confirmed: {{event}}', body: 'Hello {{name}},\n\nYou are down for {{people}} at {{event}}.\n\nYou can change the head count or cancel here:\n\n{{link}}', vars: [NAME, v('event', 'Spring Open House', 'Event title'), v('people', '4', 'Head count'), v('link', 'https://portal.trinityclassical.academy/events', 'Events page')] },
	{ key: 'event.cancelled', name: 'Event cancelled', stage: 'events', audience: 'Families who RSVPed', trigger: 'Staff delete an event',
		subject: '{{event}} was cancelled', body: 'The school cancelled {{event}}.', vars: [v('event', 'Spring Open House', 'Event title')] },
	{ key: 'interview.invite', name: 'Choose an interview time', stage: 'applying', audience: 'Applying family', trigger: 'Staff move an application to Interview',
		subject: 'Choose a time for your Trinity interview', body: "Hello {{name}},\n\nThank you for your interest in Trinity Classical Academy. We'd love to meet your family. Please sign in to the TCA Portal and choose an interview time on the Apply page.\n\n{{link}}", vars: [NAME, v('link', 'https://portal.trinityclassical.academy/applications', 'The Apply page')] },
	{ key: 'application.approved', name: 'Approved: complete the application', stage: 'applying', audience: 'Applying family', trigger: 'Staff approve a family after the interview',
		subject: 'Next step: your Trinity application', body: "Hello {{name}},\n\nThank you for meeting with us. We'd love for your family to continue, and the next step is the full application. It takes about 20 minutes and you can save as you go.\n\n{{link}}", vars: [NAME, v('link', 'https://portal.trinityclassical.academy/g/forms/…', 'The family’s application')] },
	{ key: 'application.declined', name: 'Not approved', stage: 'applying', audience: 'Applying family', trigger: 'Staff mark an application Not approved',
		subject: 'About your application to Trinity', body: 'Hello {{name}},\n\nThank you for considering Trinity Classical Academy and for the time you spent with us. We’re not able to offer a place this year. If you have questions, please reply to this email.', vars: [NAME] },
	{ key: 'application.received', name: 'Application received', stage: 'applying', audience: 'Applying family', trigger: 'A family submits the full application',
		subject: 'We received your application', body: "Hello {{name}},\n\nWe received your application. Next, we'll confirm a place for each child and send an enrollment agreement to sign. You can follow along on the Apply page:\n\n{{link}}", vars: [NAME, v('link', 'https://portal.trinityclassical.academy/applications', 'Apply page')] },
	{ key: 'enrollment.agreement', name: 'Sign the enrollment agreement', stage: 'applying', audience: 'Enrolling family', trigger: 'A child’s enrollment opens and an enrollment agreement form exists',
		subject: 'Enrollment agreement for {{child}}', body: 'Hello {{name}},\n\nPlease review and sign the {{year}} enrollment agreement for {{child}}. Signing it confirms the place.\n\n{{link}}', vars: [NAME, v('child', 'Evelyn', 'Child’s first name'), v('year', '2027–28', 'School year'), v('link', 'https://portal.trinityclassical.academy/g/forms/…', 'That child’s agreement')] },
	{ key: 'enrollment.enrolled', name: 'Enrolled', stage: 'applying', audience: 'Enrolling family', trigger: 'A child is enrolled (agreement signed, or staff mark them enrolled)',
		subject: '{{child}} is enrolled for {{year}}', body: 'Hello {{name}},\n\n{{child}} is enrolled at Trinity Classical Academy for {{year}}. Welcome! Watch the portal for forms and dates before the first day.\n\n{{link}}', vars: [NAME, v('child', 'Evelyn', 'Child’s first name'), v('year', '2027–28', 'School year'), v('link', 'https://portal.trinityclassical.academy', 'Portal')] },
	{ key: 'enrollment.waitlisted', name: 'Waitlisted', stage: 'applying', audience: 'Applying family', trigger: 'Staff waitlist a child because a grade is full',
		subject: '{{child}} is on our waitlist', body: "Hello {{name}},\n\n{{grade}} is full for {{year}}, so {{child}} is on our waitlist. We'll write as soon as a place opens. If your plans change, just reply to this email.", vars: [NAME, v('child', 'Sam', 'Child’s first name'), v('grade', 'Grade 3', 'The grade'), v('year', '2027–28', 'School year')] },
	{ key: 'interview.booked', name: 'Interview booked', stage: 'applying', audience: 'Applying family', trigger: 'A family books an interview time',
		subject: 'Your Trinity interview time', body: 'Hello {{name}},\n\nYour interview with Trinity Classical Academy is on {{when}}.\n{{campus}}\n\nYou can change or cancel it on the Apply page:\n\n{{link}}', vars: [NAME, v('when', 'Thursday, December 3, 2026, 4:00 PM–4:45 PM', 'Date and time'), CAMPUS, v('link', 'https://portal.trinityclassical.academy/applications', 'Apply page')] },
	{ key: 'announcement', name: 'Announcement', stage: 'enrolled', audience: 'Enrolled families', trigger: 'Staff publish an announcement with “Email it” on', authored: true,
		subject: '{{title}}', body: 'Dear Trinity families,\n\n{{body}}\n\n{{signoff}}\n{{signer}}', vars: [v('title', 'Friday recitation and chapel', 'Written by staff'), v('body', 'We look forward to learning together. Please check the family calendar for upcoming dates.', 'Written by staff'), v('signoff', 'Warmly,', 'Closing line, set on each letter'), v('signer', 'Trinity Classical Academy', 'Who signs it, set on each letter')] },
	{ key: 'document.new', name: 'New document', stage: 'enrolled', audience: 'Enrolled families', trigger: 'Staff publish a document with “Email families” on',
		subject: 'New document: {{title}}', body: '{{title}} is in your TCA Portal documents.\n\n{{link}}', vars: [v('title', 'Winter newsletter', 'Document title'), v('link', 'https://portal.trinityclassical.academy/g/documents', 'Documents page')] },
	{ key: 'form.reminder', name: 'Form reminder', stage: 'enrolled', audience: 'Families who haven’t submitted', trigger: 'Staff press Remind on a form',
		subject: 'Form still needed: {{title}}', body: 'Please finish {{title}}{{due}}. It takes a few minutes:\n\n{{link}}', vars: [v('title', 'Photo permission', 'Form title'), v('due', ' by December 4, 2026', 'Due date (blank when none)'), v('link', 'https://portal.trinityclassical.academy/g/forms/…', 'That family’s form')] },
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
export async function renderEmail(key: string, vars: Record<string, string | number | undefined>, overrides?: Record<string, EmailOverride>): Promise<{ subject: string; text: string; html: string }> {
	const template = emailTemplate(key);
	if (!template) throw new Error(`Unknown email: ${key}`);
	const edit = (overrides ?? await emailOverrides())[key];
	const subject = fillTemplate(edit?.subject ?? template.subject, vars).replace(/\s+/g, ' ');
	const text = `${fillTemplate(edit?.body ?? template.body, vars)}\n`;
	const letter = template.authored ? { title: String(vars.title ?? subject), body: String(vars.body ?? ''), signOff: String(vars.signoff ?? ''), signedBy: String(vars.signer ?? '') } : undefined;
	return { subject, text, html: emailHtml({ subject, text, letter, origin: portalOrigin() }) };
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

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";

/** Plain text to email-safe HTML paragraphs: a paragraph that's only a link becomes a button. */
function paragraphsHtml(text: string): string {
	return text.trim().split(/\n{2,}/).map((paragraph) => {
		const only = paragraph.trim();
		if (/^https?:\/\/\S+$/.test(only)) {
			return `<p style="margin:24px 0"><a href="${escapeHtml(only)}" style="display:inline-block;background:#276d33;color:#ffffff;text-decoration:none;font:600 15px/1 ${SANS};padding:13px 22px;border-radius:999px">Open in the TCA Portal</a></p>`;
		}
		const linked = escapeHtml(paragraph).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#276d33">$1</a>').replace(/\n/g, '<br>');
		return `<p style="margin:0 0 16px">${linked}</p>`;
	}).join('');
}

/**
 * The branded HTML version of an email: emblem and name, the message on a
 * white card, and a short footer. Announcements read as a letter (title,
 * greeting, sign-off). Plain text always goes alongside it.
 */
export function emailHtml(input: { subject: string; text: string; letter?: { title: string; body: string; signOff?: string; signedBy?: string }; origin: string }): string {
	const logo = `${input.origin}/assets/img/emblem-green.png`;
	const content = input.letter
		? `<h1 style="margin:0 0 20px;font:400 28px/1.25 ${SERIF};color:#1a1a18">${escapeHtml(input.letter.title)}</h1>
			<p style="margin:0 0 16px;font:400 17px/1.65 ${SERIF}">Dear Trinity families,</p>
			<div style="font:400 17px/1.65 ${SERIF};color:#2b2b27">${paragraphsHtml(input.letter.body)}</div>
			<p style="margin:28px 0 4px;font:400 17px/1.5 ${SERIF}">${escapeHtml(input.letter.signOff || 'Warmly,')}</p>
			<p style="margin:0;font:400 19px/1.4 ${SERIF};color:#1d5527">${escapeHtml(input.letter.signedBy || 'Trinity Classical Academy').replace(/\n/g, '<br>')}</p>`
		: `<div style="font:400 16px/1.6 ${SANS};color:#2b2b27">${paragraphsHtml(input.text)}</div>`;
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f2ea">
<span style="display:none;max-height:0;overflow:hidden">${escapeHtml(input.text.replace(/\s+/g, ' ').slice(0, 120))}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ea"><tr><td align="center" style="padding:28px 12px">
	<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
		<tr><td style="padding:0 4px 18px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
			<td style="vertical-align:middle;padding-right:10px"><img src="${logo}" width="32" height="32" alt="" style="display:block"></td>
			<td style="vertical-align:middle;font:600 12px/1 ${SANS};letter-spacing:.14em;text-transform:uppercase;color:#1d5527">Trinity Classical Academy</td>
		</tr></table></td></tr>
		<tr><td style="background:#ffffff;border:1px solid #e3e0d6;border-radius:8px;padding:${input.letter ? '36px 40px' : '28px 32px'}">${content}</td></tr>
		<tr><td style="padding:18px 4px 0;font:400 12px/1.6 ${SANS};color:#7a7a72">Trinity Classical Academy · 7160 Cahaba Valley Rd., Birmingham, AL 35242<br><a href="${input.origin}" style="color:#7a7a72">TCA Portal</a></td></tr>
	</table>
</td></tr></table>
</body></html>`;
}
