import type { Application } from '@tca/school';

/**
 * Family-facing view of one child's application: five steps, each done,
 * current or upcoming, and at most one thing for the family to do.
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

export function trackApplication(app: Application, enrollment: string | undefined): Tracker {
	const at = ['requested', 'interview', 'interviewed', 'application_sent', 'application_submitted', 'accepted'].indexOf(app.status);
	const enrolled = enrollment === 'enrolled';
	const state = (index: number, current: boolean): StepState => current ? 'current' : at >= index ? 'done' : 'upcoming';
	const closed = ['waitlisted', 'declined', 'withdrawn'].includes(app.status);
	const steps = [
		{ label: 'Interview request', state: 'done' as StepState, detail: 'Received' },
		{ label: 'Interview', state: state(2, at === 0 || at === 1), detail: at <= 1 ? 'The office will contact you to schedule it' : 'Done' },
		{ label: 'Full application', state: state(4, at === 3), detail: at === 3 ? 'Check your email for the application link' : at >= 4 ? 'Submitted' : '' },
		{ label: 'Decision', state: closed ? 'done' as StepState : state(5, at === 4), detail: at === 5 ? 'Accepted' : closed ? (app.status === 'waitlisted' ? 'Waitlisted' : app.status === 'declined' ? 'Not accepted' : 'Withdrawn') : at === 4 ? 'The school is reviewing the application' : '' },
		{ label: 'Enroll', state: enrolled ? 'done' as StepState : at === 5 ? 'current' as StepState : 'upcoming' as StepState, detail: enrolled ? 'Enrolled' : at === 5 ? 'The office will send the enrollment contract' : '' },
	];
	if (closed) return {
		steps: steps.slice(0, 4), closed: true, todo: null, tone: app.status === 'waitlisted' ? 'b-gold' : 'b-gray',
		headline: app.status === 'waitlisted' ? 'Waitlisted. We’ll be in touch if a spot opens.' : app.status === 'declined' ? 'We’re unable to offer a place this year.' : 'This application was withdrawn.',
	};
	if (enrolled) return { steps, closed: false, todo: null, tone: 'b-green', headline: `Enrolled for ${app.schoolYear}. Welcome to Trinity.` };
	const headline = ['Interview request received', 'Invited to interview', 'Interview done', 'Application sent to you', 'Application received', 'Accepted'][at] ?? 'Received';
	return {
		steps, closed: false, tone: at === 5 ? 'b-green' : at === 3 ? 'b-gold' : 'b-gray', headline,
		todo: at === 3 ? `Complete ${app.childName || 'your child'}’s ${app.schoolYear} application (check your email for the link)` : null,
	};
}
