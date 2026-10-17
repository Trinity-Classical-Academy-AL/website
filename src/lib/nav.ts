// Shared primary navigation. Header renders this; structured data reads the
// same internal links so SiteNavigationElement cannot drift from the menu.

import { CLASSREACH_URL, GIVE_URL, INTERVIEW_URL } from './links.ts';

export type NavItem = {
	label: string;
	href: string;
	external?: boolean;
	phEvent?: string;
	phLocation?: string;
};

export const navCategories: {
	marker: string;
	label: string;
	id: string;
	items: NavItem[];
}[] = [
	{
		marker: 'I.',
		label: 'About',
		id: 'about',
		items: [
			{ label: 'Our Vision', href: '/#our-vision' },
			{ label: 'How It Works', href: '/how-it-works' },
			{ label: 'Curriculum', href: '/curriculum' },
			{ label: 'People', href: '/people' },
		],
	},
	{
		marker: 'II.',
		label: 'Admissions',
		id: 'admissions',
		items: [
			{ label: 'Admissions Process', href: '/admissions' },
			{
				label: 'Request an Interview',
				href: INTERVIEW_URL,
				external: true,
				phEvent: 'interview_requested_click',
				phLocation: 'header',
			},
		],
	},
	{
		marker: 'III.',
		label: 'Families',
		id: 'families',
		items: [
			{ label: 'Resources', href: '/resources' },
			{ label: 'FAQ', href: '/faq' },
			{ label: 'Tuition Policy', href: '/resources/tuition' },
			{ label: 'Uniform Policy', href: '/resources/uniform' },
			{
				label: 'Parent Login',
				href: CLASSREACH_URL,
				external: true,
			},
		],
	},
	{
		marker: 'IV.',
		label: 'Get Involved',
		id: 'get-involved',
		items: [
			{
				label: 'Give',
				href: GIVE_URL,
				external: true,
			},
			{ label: 'Careers', href: '/careers' },
			{ label: 'Contact', href: '/contact' },
		],
	},
];
