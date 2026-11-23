import { createHash } from 'node:crypto';
import { db, dbReady } from './db.ts';
import { isLocalDev } from './dev/local-guard.ts';

export type EmailResult = { delivered: boolean; reason?: string };

function fromAddress(): string {
	return process.env.EMAIL_FROM || 'Trinity Classical Academy <noreply@trinityclassical.academy>';
}

export function portalOrigin(): string {
	return (process.env.PORTAL_ORIGIN || 'https://portal.trinityclassical.academy').replace(/\/$/, '');
}

export function siteOrigin(): string {
	return (process.env.PUBLIC_SITE_URL || 'https://trinityclassical.academy').replace(/\/$/, '');
}

export function staffNotifyEmail(): string {
	return process.env.STAFF_NOTIFY_EMAIL || 'michelle.taylor@trinityclassical.academy';
}

/** Formaloo application. Updates come from Formaloo, not this app. */
export const FORMALOO_APPLY_URL = 'https://trinity-classicalalabama.formaloo.me/tqo8fo';

/**
 * Where "Request an interview" goes: Formaloo while admissions still run there,
 * the portal's own form once INTERVIEW_FORM=portal (the website's links.ts changes then too).
 */
export function interviewRequestUrl(): string {
	return process.env.INTERVIEW_FORM === 'portal' ? '/interview' : FORMALOO_APPLY_URL;
}

/** Record one attempt; logging never blocks or breaks a send. */
async function logEmail(input: { to: string; subject: string; template?: string }, fingerprint: string, result: EmailResult): Promise<void> {
	try {
		await dbReady();
		await db()`insert into email_log (template, recipient, subject, fingerprint, delivered, reason) values (${input.template ?? ''}, ${input.to}, ${input.subject.slice(0, 300)}, ${fingerprint}, ${result.delivered}, ${result.reason ?? ''})`;
	} catch (error) { console.error('[email] could not log', error); }
}

/** The same email to the same people in the last two minutes (a double click, a retry). */
async function sentJustNow(to: string, fingerprint: string): Promise<boolean> {
	try {
		await dbReady();
		const [row] = await db()`select 1 from email_log where recipient = ${to} and fingerprint = ${fingerprint} and delivered and at > now() - interval '2 minutes' limit 1`;
		return !!row;
	} catch { return false; }
}

export async function sendEmail(input: { to: string; subject: string; text: string; html?: string; replyTo?: string; template?: string }): Promise<EmailResult> {
	const fingerprint = createHash('sha256').update(`${input.subject}\n${input.text}`).digest('hex').slice(0, 32);
	const result = await deliver(input, fingerprint);
	await logEmail(input, fingerprint, result);
	return result;
}

async function deliver(input: { to: string; subject: string; text: string; html?: string; replyTo?: string }, fingerprint: string): Promise<EmailResult> {
	if (!input.to.trim()) return { delivered: false, reason: 'no-recipient' };
	if (await sentJustNow(input.to, fingerprint)) return { delivered: false, reason: 'duplicate' };
	if (isLocalDev()) {
		console.info(`[dev email] ${JSON.stringify({ to: input.to, subject: input.subject })}`);
		return { delivered: false, reason: 'dev-local' };
	}
	const key = process.env.RESEND_API_KEY ?? '';
	if (!key) {
		console.info(`[email] RESEND_API_KEY is not set. Not sent.\nTo: ${input.to}\nSubject: ${input.subject}\n${input.text}`);
		return { delivered: false, reason: 'resend-not-configured' };
	}
	const response = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: {
			authorization: `Bearer ${key}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify({
			from: fromAddress(),
			// One message to everyone a family routes it to ("a@x, b@y").
			to: input.to.split(',').map((address) => address.trim()).filter(Boolean),
			subject: input.subject,
			text: input.text,
			...(input.html ? { html: input.html } : {}),
			...(input.replyTo ? { reply_to: input.replyTo } : {}),
		}),
	});
	if (!response.ok) {
		const detail = await response.text();
		console.error('[email] Resend rejected the message', response.status, detail.slice(0, 500));
		return { delivered: false, reason: 'resend-rejected' };
	}
	return { delivered: true };
}

export async function notifyStaff(subject: string, text: string): Promise<EmailResult> {
	const targets = new Set<string>([staffNotifyEmail().toLowerCase()]);
	try {
		await dbReady();
		// Admins by household (older accounts) and by person (Staff & access).
		const rows = await db()`
			select id from families where 'admin' = any(roles) and merged_into_id is null
		`;
		for (const row of await db()`select lower(email) as email from family_emails where 'admin' = any(roles) and child_id is null`) targets.add(String(row.email));
		const { routeEmail } = await import('./accounts.ts');
		for (const row of rows) {
			for (const email of (await routeEmail(String(row.id), 'admin', '')).split(',')) if (email.trim()) targets.add(email.trim().toLowerCase());
		}
	} catch (error) {
		console.error('[email] Could not read admin alert addresses', error);
	}
	let result: EmailResult = { delivered: false };
	for (const to of targets) result = await sendEmail({ to, subject, text });
	const webhook = process.env.SCHOOL_NOTIFY_WEBHOOK_URL;
	if (webhook && isLocalDev()) {
		console.info(`[dev webhook] ${JSON.stringify({ to: 'school notify webhook', subject })}`);
	} else if (webhook) {
		try {
			const headers: Record<string, string> = { 'content-type': 'application/json' };
			if (process.env.SCHOOL_NOTIFY_WEBHOOK_TOKEN) headers.authorization = `Bearer ${process.env.SCHOOL_NOTIFY_WEBHOOK_TOKEN}`;
			await fetch(webhook, {
				method: 'POST',
				headers,
				body: JSON.stringify({ type: subject, text, data: { subject, text } }),
				signal: AbortSignal.timeout(5000),
			});
		} catch (error) {
			console.error('[email] SCHOOL_NOTIFY_WEBHOOK_URL failed', error);
		}
	}
	return result;
}
