import { CAMPUS } from '../campus.ts';
import { portalOrigin } from '../email.ts';
import { sendTemplate } from '../email-catalog.ts';
import { sendEmail } from '../email.ts';
import { routeEmail } from '../accounts.ts';
import type { CancelledHold } from '../scheduling/schedule-series.ts';
import { formatTourWhen } from './model.ts';

export async function notifyCancelledTours(holds: CancelledHold[]) {
	for (const hold of holds) await sendTemplate('tour.school-cancelled', await routeEmail(hold.family_id, 'tours', hold.email), { name: hold.family_name, when: formatTourWhen(hold.slot_date, hold.start_time, hold.end_time), link: `${portalOrigin()}/tour` });
}
