import { getNotifyWebhookToken, getNotifyWebhookUrl } from './auth.ts';

/**
 * Notification hook for new tour requests and interest submissions.
 *
 * This repo has no email provider. The contact form is a Netlify Form, and
 * any mail it sends is a dashboard setting, not a code path these JSON APIs
 * can use. Submissions are still stored in Netlify Blobs and listed in the staff admin.
 *
 * To email the school, set SCHOOL_NOTIFY_WEBHOOK_URL to an endpoint you
 * control (a Zapier/Make mail step, or a small worker). The function POSTs
 * JSON `{ type, text, data }`. `text` is a plain-text message ready to
 * forward. If SCHOOL_NOTIFY_WEBHOOK_TOKEN is set, it is sent as
 * `Authorization: Bearer …`.
 *
 * A missing URL or a webhook failure does not fail the family's submission.
 * The outcome is written to the function log.
 */
export type SchoolNotice = {
	type: 'tour_requested' | 'interest_submitted';
	text: string;
	data: Record<string, unknown>;
};

export async function notifySchool(notice: SchoolNotice): Promise<{ delivered: boolean; reason: string }> {
	const url = getNotifyWebhookUrl();
	if (!url) {
		console.info(
			`School notify hook skipped for ${notice.type}: SCHOOL_NOTIFY_WEBHOOK_URL is not set. No email provider is configured in this repo.`,
		);
		return { delivered: false, reason: 'webhook-not-configured' };
	}

	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	const token = getNotifyWebhookToken();
	if (token) headers.Authorization = `Bearer ${token}`;

	try {
		const response = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify(notice),
			signal: AbortSignal.timeout(5000),
		});
		if (!response.ok) {
			console.error(`School notify hook returned ${response.status} for ${notice.type}.`);
			return { delivered: false, reason: `webhook-${response.status}` };
		}
		return { delivered: true, reason: 'delivered' };
	} catch (error) {
		console.error(`School notify hook failed for ${notice.type}.`, error);
		return { delivered: false, reason: 'webhook-error' };
	}
}
