// Single source of truth for external URLs that appear in multiple
// components/pages. If any of these change, update them here only.

/** GivingFuel donation page. Used by the nav and footer "Give" links. */
export const GIVE_URL =
	'https://trinityclassical.givingfuel.com/trinity-classical-academy-general-giving';

/** ClassReach parent/student portal. */
export const CLASSREACH_URL =
	'https://trinityclassicalacademy.classreach.com/Login';

/** TCA Portal. Email links use PORTAL_ORIGIN and should match this host. */
export const PORTAL_URL = 'https://portal.trinityclassical.academy';

/** Public interview request; no account required. */
export const INTERVIEW_URL = `${PORTAL_URL}/interview`;

/** Create an account, then land on Request a tour. */
export const PORTAL_TOUR_SIGNUP = `${PORTAL_URL}/signup?next=tour`;

/** Sign in, then land on Request a tour. */
export const PORTAL_TOUR_SIGNIN = `${PORTAL_URL}/?next=tour`;

/** Formaloo teacher application form. Used by Careers and Hero CTAs. */
export const TEACHER_APP_URL =
	'https://trinity-classicalalabama.formaloo.me/8tozru';
