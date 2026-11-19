import { chicagoToday, listSeries } from '../scheduling/schedule-series.ts';
import { formatTourClock, slotTypeLabel } from './model.ts';
import { listTourSlotSummary } from './slots.ts';

export const TOUR_NOTE = "Tours run during a normal school day, Wednesdays and Thursdays from 8:10 to 9:00 AM. Please arrive by 8:10; we begin with chapel at 8:15. To respect our teachers' and staff's time, we wrap up by 9:00. One family per tour.";

const DAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
export function tourClockRange(start: string, end: string): string {
	const first = formatTourClock(start), last = formatTourClock(end);
	return `${first.slice(-2) === last.slice(-2) ? first.slice(0, -3) : first} to ${last}`;
}
export async function publishedTourSummary() {
	const rules = (await listSeries()).filter(r => r.published && r.type === 'tour');
	if (!rules.length) return null;
	const days = [...new Set(rules.flatMap(r => r.weekdays))].sort((a, b) => a - b);
	return { when: days.map(d => DAY_NAMES[d]).join(' & '), time: tourClockRange(rules[0].start, rules[0].end), note: TOUR_NOTE };
}
export async function websiteTourSlots(today = chicagoToday()) {
	const [all, summary] = await Promise.all([listTourSlotSummary({ publicOnly: true, today }), publishedTourSummary()]);
	return { summary, slots: all.filter(s => s.published && s.date >= today && s.taken < s.capacity).slice(0, 3)
		.map(s => ({ when: s.when, type: slotTypeLabel(s.type), open: s.taken < s.capacity })) };
}
