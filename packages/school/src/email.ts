import { db, dbReady } from './db.ts';

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

export async function sendEmail(input: { to: string; subject: string; text: string }): Promise<EmailResult> {
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
			to: [input.to],
			subject: input.subject,
			text: input.text,
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
		const rows = await db()`
			select distinct lower(r.email) as email
			from notification_routes r
			join families f on f.id = r.family_id
			where r.category = 'admin' and 'admin' = any(f.roles)
		`;
		for (const row of rows) {
			const email = String(row.email || '').trim().toLowerCase();
			if (email) targets.add(email);
		}
	} catch (error) {
		console.error('[email] Could not read admin alert addresses', error);
	}
	let result: EmailResult = { delivered: false };
	for (const to of targets) result = await sendEmail({ to, subject, text });
	const webhook = process.env.SCHOOL_NOTIFY_WEBHOOK_URL;
	if (webhook) {
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
