/**
 * Staff-facing defaults for tours, the announcement banner, and admin access.
 * Change them here. The pull request lists every value that was left open.
 */
export const TOUR_DEFAULTS = {
	/** 24-hour clock, America/Chicago. */
	startTime: '09:00',
	endTime: '10:00',
	/** Seats on a tour date until a staff member changes that date. */
	capacity: 12,
	/** Tours run in these months only. 1 = January. */
	months: [1, 2, 3] as const,
	/** 0 = Sunday … 3 = Wednesday. */
	weekday: 3,
	/** 2 = the second Wednesday of the month. */
	nthWeekday: 2,
	timeZone: 'America/Chicago',
	location: '7160 Cahaba Valley Rd., Birmingham, AL 35242',
	schoolEmail: 'info@trinityclassical.academy',
	/** Shown on the tour success panel. The date and time are added beside it. */
	confirmationMessage: "We've received your tour request.",
	whatToExpect:
		'A walk through our classrooms with a member of the faculty, and time for your questions about admissions, the cohort model, and tuition.',
	bannerTextMax: 120,
	flyerMaxBytes: 8 * 1024 * 1024,
	/** Staff cookie length on the admin host. The portal uses its own 30-day family session. */
	sessionDays: 14,
	adminTokenEnv: 'TCA_ADMIN_TOKEN',
	notifyWebhookEnv: 'SCHOOL_NOTIFY_WEBHOOK_URL',
	notifyTokenEnv: 'SCHOOL_NOTIFY_WEBHOOK_TOKEN',
	/** localStorage key. The stored value is the banner version, not a boolean. */
	dismissalStorageKey: 'tca:banner:dismissed',
} as const;

export const GRADE_OPTIONS = [
	{ value: 'K', label: 'K' },
	{ value: '1', label: '1st' },
	{ value: '2', label: '2nd' },
	{ value: '3', label: '3rd' },
	{ value: '4', label: '4th' },
	{ value: '5', label: '5th' },
	{ value: '6', label: '6th' },
	{ value: '7', label: '7th' },
	{ value: '8', label: '8th' },
] as const;

export const GRADE_VALUES = GRADE_OPTIONS.map((grade) => grade.value);

export const HEAR_ABOUT_OPTIONS = [
	{ value: 'friend', label: 'A friend or family member' },
	{ value: 'church', label: 'Trinity Presbyterian Church' },
	{ value: 'website', label: 'The website' },
	{ value: 'social', label: 'Social media' },
	{ value: 'event', label: 'An info night or event' },
	{ value: 'other', label: 'Something else' },
] as const;

export const HEAR_ABOUT_VALUES = HEAR_ABOUT_OPTIONS.map((option) => option.value);

export const TOUR_FIELD_ORDER = [
	'parentName',
	'email',
	'phone',
	'children',
	'grades',
	'tourDateId',
	'hearAbout',
	'message',
] as const;

export const INTEREST_FIELD_ORDER = ['name', 'email', 'phone', 'message'] as const;
