import { chicagoToday, classroomOverview, enrollmentCounts, listApplications, listCalendar, listSignups, overdueForms, schoolYearOf, shiftSchoolYear } from '@tca/school';

/**
 * The admin overview answers two questions: what needs a reply, and how
 * enrollment is going. Plus the next seven days of the calendar.
 */
export async function loadOverview() {
	const today = chicagoToday();
	const current = schoolYearOf(), next = shiftSchoolYear(current, 1);
	const weekEnd = new Date(Date.parse(`${today}T12:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10);
	const [signups, apps, forms, enrollment, calendar, classroom] = await Promise.all([listSignups(), listApplications(), overdueForms(today), enrollmentCounts(current, next), listCalendar(), classroomOverview(today)]);
	const upcomingApps = apps.filter((app) => app.schoolYear >= next);
	const plural = (count: number, one: string, many: string) => count === 1 ? one : many;
	const tourReplies = signups.filter((row) => row.kind === 'request' && ['new', 'contacted'].includes(row.status)).length;
	const interviews = upcomingApps.filter((app) => app.status === 'requested').length;
	const toDecide = upcomingApps.filter((app) => app.status === 'interview').length;
	const needs = [
		tourReplies && { count: tourReplies, text: `${plural(tourReplies, 'family wants', 'families want')} a different tour time`, href: '/admin/calendar/rsvps?show=reply' },
		interviews && { count: interviews, text: `${plural(interviews, 'interview request', 'interview requests')} to schedule`, href: '/admin/applications?status=requested' },
		toDecide && { count: toDecide, text: `${plural(toDecide, 'family', 'families')} to approve after the interview`, href: '/admin/applications?status=interview' },
		classroom.missingAttendance.length && { count: classroom.missingAttendance.length, text: `${plural(classroom.missingAttendance.length, 'homeroom hasn’t', 'homerooms haven’t')} taken attendance today`, href: `/staff/attendance?class=${classroom.missingAttendance[0].id}` },
		classroom.awaitingReply && { count: classroom.awaitingReply, text: `${plural(classroom.awaitingReply, 'family message is', 'family messages are')} waiting on a reply`, href: '/staff/messages' },
		classroom.unreleased && { count: classroom.unreleased.classes.length, text: `${plural(classroom.unreleased.classes.length, 'class hasn’t', 'classes haven’t')} released ${classroom.unreleased.term.name} report cards`, href: `/staff/report-cards?class=${classroom.unreleased.classes[0].id}&term=${classroom.unreleased.term.id}` },
		...forms.map((form) => ({ count: form.missing, text: `${plural(form.missing, 'family hasn’t', 'families haven’t')} turned in “${form.title}”`, href: `/admin/forms/${form.id}` })),
	].filter(Boolean) as { count: number; text: string; href: string }[];
	// Families still applying: not closed, and not every child settled.
	const pipeline = upcomingApps.filter((app) => !['declined', 'withdrawn'].includes(app.status) && !(app.children.length && app.children.every((kid) => kid.enrollment && kid.enrollment !== 'pending'))).length;
	// Open tour times nobody booked are noise here; booked tours and everything else show.
	const week = calendar.filter((item) => item.date >= today && item.date <= weekEnd && (item.source !== 'tour' || item.taken > 0));
	return { today, current, next, needs, enrollment, pipeline, week, classroom };
}
