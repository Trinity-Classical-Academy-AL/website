// Example forms for local dev: one per purpose (Documents & forms → Forms).
// Question types: short, long, yesno, choice, date, phone, file.
const q = (id, label, type, required = false, options) => ({ id, label, type, required, ...(options ? { options } : {}) });

export const EXAMPLE_FORMS = [
	{
		key: 'example-student-application', purpose: 'application', status: 'open', title: 'Student application',
		instructions: 'Complete one application for your family. List each child applying. Your answers help us place each student well; there are no wrong answers.',
		questions: [
			q('parents', 'Parent or guardian names', 'short', true),
			q('phone', 'Best phone number', 'phone', true),
			q('address', 'Home address', 'long', true),
			q('church', 'Home church and pastor', 'short', true),
			q('students', 'Each child applying: full name, date of birth and grade for next year', 'long', true),
			q('current', 'Where do your children attend school now?', 'choice', true, ['Public school', 'Private school', 'Homeschool', 'Classical school', 'Not yet in school']),
			q('why', 'Why are you interested in classical Christian education at Trinity?', 'long', true),
			q('faith', 'Briefly describe your family’s faith', 'long', true),
			q('support', 'Does any child have learning needs or an IEP we should know about?', 'long'),
			q('records', 'Most recent report card or homeschool portfolio', 'file'),
			q('heard', 'How did you hear about Trinity?', 'choice', false, ['Friend or family', 'Church', 'Event or open house', 'Online', 'Other']),
			q('statement', 'I have read and agree with Trinity’s statement of faith', 'yesno', true),
		],
	},
	{
		key: 'example-enrollment-agreement', purpose: 'contract', status: 'open', title: 'Enrollment agreement',
		instructions: 'One agreement per child enrolling. Read each item and sign at the bottom.',
		questions: [
			q('tuition', 'I agree to pay tuition and fees on the schedule I choose below', 'yesno', true),
			q('plan', 'Payment plan', 'choice', true, ['Annual (one payment)', 'Semester (two payments)', 'Monthly (ten payments)']),
			q('handbook', 'I have read the family handbook and agree to follow it', 'yesno', true),
			q('partnership', 'I will support my child’s work at home on non-campus days', 'yesno', true),
			q('photo', 'Trinity may use photos of my child in school publications', 'yesno', true),
			q('start', 'First day of school', 'date'),
		],
	},
	{
		key: 'example-reenrollment', purpose: 'reenrollment', status: 'open', title: 'Re-enrollment',
		instructions: 'Let us know your plans for next year. Re-enrolling holds your child’s place before seats open to new families.',
		questions: [
			q('returning', 'Will this student return next year?', 'choice', true, ['Yes, re-enroll', 'Not sure yet', 'No, we won’t return']),
			q('reason', 'If not returning or unsure, can you tell us why?', 'long'),
			q('changes', 'Any changes to address, phone or emergency contacts?', 'long'),
			q('medical', 'Any new medical needs, allergies or medications?', 'long'),
			q('assist', 'Do you plan to apply for tuition assistance?', 'yesno', true),
			q('volunteer', 'How would you like to help next year?', 'choice', false, ['Room parent', 'Events', 'Lunch or recess', 'Prayer team', 'Not this year']),
		],
	},
	{
		key: 'example-teacher-application', purpose: 'teacher', status: 'open', title: 'Teacher full application',
		instructions: 'Thank you for continuing with us. This takes about 30 minutes. Your answers save as a draft until you submit.',
		questions: [
			q('address', 'Home address', 'long', true),
			q('degree', 'Highest degree, field and school', 'short', true),
			q('cert', 'Teaching certification, if any', 'short'),
			q('history', 'Teaching or related work history (most recent first)', 'long', true),
			q('subjects', 'Grades and subjects you’re prepared to teach', 'long', true),
			q('classical', 'What draws you to classical Christian education, and what have you read about it?', 'long', true),
			q('testimony', 'Share your Christian testimony', 'long', true),
			q('church', 'Home church, how long you’ve attended and your pastor’s name', 'short', true),
			q('statement', 'I affirm Trinity’s statement of faith', 'yesno', true),
			q('lesson', 'Describe a lesson you’ve taught that went well, and why', 'long', true),
			q('availability', 'When could you start?', 'date', true),
			q('schedule', 'What schedule are you looking for?', 'choice', true, ['Full time', 'Part time', 'One or two classes', 'Substitute']),
			q('references', 'Three references: name, relationship, phone and email (include your pastor)', 'long', true),
			q('background', 'I consent to a background check', 'yesno', true),
			q('transcript', 'Transcript (unofficial is fine)', 'file'),
		],
	},
	{
		key: 'example-medical', purpose: 'general', status: 'open', title: 'Medical and emergency information',
		instructions: 'One per student. We keep this on file for field trips and emergencies.',
		questions: [
			q('emergency', 'Emergency contact (not a parent): name and relationship', 'short', true),
			q('emergencyPhone', 'Emergency contact phone', 'phone', true),
			q('doctor', 'Doctor’s name and phone', 'short'),
			q('allergies', 'Allergies', 'long'),
			q('meds', 'Medications taken at school', 'long'),
			q('otc', 'Staff may give over-the-counter pain relief if needed', 'yesno', true),
			q('insurance', 'Insurance card (front)', 'file'),
		],
	},
];
