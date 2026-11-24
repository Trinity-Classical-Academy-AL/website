import type { Application } from '@tca/school';

/**
 * Family-facing view of the family's application: five steps, each done,
 * current or upcoming, and at most one thing for the family to do. The school
 * approves once, after the interview; enrollment is then per child.
 */
export type StepState = 'done' | 'current' | 'upcoming';
export type Tracker = {
	steps: { label: string; state: StepState; detail: string }[];
	headline: string;
	tone: 'b-gray' | 'b-gold' | 'b-green';
	/** Something the family should do now, for To do and Home. */
	todo: string | null;
	closed: boolean;
};

export function trackApplication(app: Application): Tracker {
	// Accepted reads as the last step here: the family finishes enrolling (in ClassReach for now).
	const at = Math.min(['requested', 'interview', 'approved', 'application_submitted', 'accepted'].indexOf(app.status), 3);
	const accepted = app.status === 'accepted';
	const kids = app.children;
	const enrolled = kids.filter((kid) => kid.enrollment === 'enrolled').length;
	const settled = kids.length > 0 && kids.every((kid) => kid.enrollment && kid.enrollment !== 'pending');
	const state = (index: number): StepState => at > index ? 'done' : at === index ? 'current' : 'upcoming';
	const closed = app.status === 'declined' || app.status === 'withdrawn';
	const steps = [
		{ label: 'Interview request', state: 'done' as StepState, detail: 'Received' },
		{ label: 'Interview', state: at <= 1 ? 'current' as StepState : 'done' as StepState, detail: at === 0 ? 'The school will invite you to pick a time' : at === 1 ? (app.interviewWhen || 'Pick a time below') : 'Done' },
		{ label: 'Approved', state: closed ? 'done' as StepState : at >= 2 ? 'done' as StepState : 'upcoming' as StepState, detail: closed ? (app.status === 'declined' ? 'Not approved' : 'Withdrawn') : at >= 2 ? 'Approved' : '' },
		{ label: 'Full application', state: state(2), detail: at === 2 ? (app.fullApplication ? 'Complete it below' : 'Coming shortly') : at === 3 ? 'Submitted' : '' },
		{ label: 'Enroll', state: settled ? 'done' as StepState : at === 3 ? 'current' as StepState : 'upcoming' as StepState, detail: at === 3 ? (enrolled ? `${enrolled} of ${kids.length} enrolled` : accepted ? 'Accepted: create your ClassReach account from our email to finish' : 'We’re reviewing your application') : '' },
	];
	if (closed) return {
		steps: steps.slice(0, 3), closed: true, todo: null, tone: 'b-gray',
		headline: app.status === 'declined' ? 'We’re unable to offer a place this year.' : 'This application was withdrawn.',
	};
	if (settled && enrolled) return { steps, closed: false, todo: null, tone: 'b-green', headline: `Enrolled for ${app.schoolYear}. Welcome to Trinity.` };
	const headline = ['Interview request received', app.interviewWhen ? 'Interview booked' : 'Invited to interview', 'Approved', 'Enrolling'][at] ?? 'Received';
	return {
		steps, closed: false, tone: at >= 2 ? 'b-green' : 'b-gray', headline,
		todo: at === 1 && !app.interviewWhen ? 'Choose a time for your interview' : at === 2 && app.fullApplication ? `Complete your ${app.schoolYear} application` : null,
	};
}
