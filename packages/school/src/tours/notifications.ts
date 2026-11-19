import { CAMPUS } from '../campus.ts';
import { sendEmail } from '../email.ts';
import { routeEmail } from '../accounts.ts';
import type { CancelledHold } from '../scheduling/schedule-series.ts';
import { formatTourWhen } from './model.ts';

export async function notifyCancelledTours(holds: CancelledHold[]) {
	for (const hold of holds) await sendEmail({
		to: await routeEmail(hold.family_id, 'tours', hold.email), subject: 'A Trinity tour time was cancelled',
		text: `Hello ${hold.family_name},\n\nThe school cancelled the tour on ${formatTourWhen(hold.slot_date, hold.start_time, hold.end_time)}. Please pick another time in the TCA Portal.\n${CAMPUS}\n`,
	});
}
