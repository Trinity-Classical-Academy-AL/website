import { chicagoToday, enrollmentCounts, listApplications, listCalendar, listSignups, overdueForms, schoolYearOf, shiftSchoolYear } from '@tca/school';

/**
 * The admin overview answers two questions: what needs a reply, and how
 * enrollment is going. Plus the next seven days of the calendar.
 */
export async function loadOverview() {
	const today = chicagoToday();
	const current = schoolYearOf(), next = shiftSchoolYear(current, 1);
	const weekEnd = new Date(Date.parse(`${today}T12:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10);
	const [signups, apps, forms, enrollment, calendar] = await Promise.all([listSignups(), listApplications(), overdueForms(today), enrollmentCounts(current, next), listCalendar()]);
	const upcomingApps = apps.filter((app) => app.schoolYear >= next);
	const plural = (count: number, one: string, many: string) => count === 1 ? one : many;
	const tourReplies = signups.filter((row) => row.kind === 'request' && ['new', 'contacted'].includes(row.status)).length;
	const interviews = upcomingApps.filter((app) => app.status === 'requested').length;
	const toReview = upcomingApps.filter((app) => app.status === 'application_submitted').length;
	const needs = [
		tourReplies && { count: tourReplies, text: `${plural(tourReplies, 'family wants', 'families want')} a different tour time`, href: '/admin/calendar/rsvps?show=reply' },
		interviews && { count: interviews, text: `${plural(interviews, 'interview request', 'interview requests')} to schedule`, href: '/admin/applications?status=requested' },
		toReview && { count: toReview, text: `${plural(toReview, 'application', 'applications')} to review`, href: '/admin/applications?status=application_submitted' },
		...forms.map((form) => ({ count: form.missing, text: `${plural(form.missing, 'family hasn’t', 'families haven’t')} turned in “${form.title}”`, href: `/admin/forms/${form.id}` })),
	].filter(Boolean) as { count: number; text: string; href: string }[];
	const pipeline = upcomingApps.filter((app) => !['accepted', 'waitlisted', 'declined', 'withdrawn'].includes(app.status)).length;
	// Open tour times nobody booked are noise here; booked tours and everything else show.
	const week = calendar.filter((item) => item.date >= today && item.date <= weekEnd && (item.source !== 'tour' || item.taken > 0));
	return { today, current, next, needs, enrollment, pipeline, week };
}
