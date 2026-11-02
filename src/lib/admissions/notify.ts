import { notifyStaff } from '@tca/school';

/**
 * Notification hook for new tour requests and interest submissions.
 *
 * Staff mail goes through Resend (`RESEND_API_KEY`, `EMAIL_FROM`,
 * `STAFF_NOTIFY_EMAIL`). The record is still saved if Resend is not configured.
 * `SCHOOL_NOTIFY_WEBHOOK_URL` remains an optional extra POST of the same text.
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
	const subject = notice.type === 'tour_requested' ? 'New tour request' : 'New interest note';
	const result = await notifyStaff(subject, notice.text);
	return { delivered: result.delivered, reason: result.reason ?? (result.delivered ? 'delivered' : 'not-sent') };
}
