import { navCategories } from './nav.ts';

export type FaqEntry = {
	question: string;
	answer: string;
};

type JsonLdNode = Record<string, unknown>;

const CRUMB_LABELS: Record<string, string> = {
	admissions: 'Admissions',
	careers: 'Careers',
	contact: 'Contact',
	curriculum: 'Curriculum',
	faq: 'FAQ',
	'how-it-works': 'How It Works',
	'our-vision': 'Our Vision',
	'our-philosophy': 'Our Philosophy',
	people: 'People',
	resources: 'Resources',
	tuition: 'Tuition',
	uniform: 'Uniform',
	'brand-guide': 'Brand Guide',
	'404': 'Page not found',
};

export function normalizePath(pathname: string): string {
	if (!pathname || pathname === '/') return '/';
	const withLeading = pathname.startsWith('/') ? pathname : `/${pathname}`;
	return withLeading.length > 1 && withLeading.endsWith('/')
		? withLeading.slice(0, -1)
		: withLeading;
}

function pageUrl(siteOrigin: string, pathname: string): string {
	const path = normalizePath(pathname);
	if (path === '/') return `${siteOrigin}/`;
	return `${siteOrigin}${path}/`;
}

function crumbLabel(segment: string): string {
	return CRUMB_LABELS[segment] ?? segment.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function breadcrumbList(siteOrigin: string, pathname: string, canonical: string): JsonLdNode | null {
	const path = normalizePath(pathname);
	if (path === '/') return null;

	const segments = path.slice(1).split('/').filter(Boolean);
	const items: JsonLdNode[] = [
		{
			'@type': 'ListItem',
			position: 1,
			name: 'Home',
			item: `${siteOrigin}/`,
		},
	];

	segments.forEach((segment, index) => {
		const isLast = index === segments.length - 1;
		const href = isLast ? canonical : pageUrl(siteOrigin, `/${segments.slice(0, index + 1).join('/')}`);
		items.push({
			'@type': 'ListItem',
			position: index + 2,
			name: crumbLabel(segment),
			item: href,
		});
	});

	return {
		'@type': 'BreadcrumbList',
		itemListElement: items,
	};
}

function navUrl(siteOrigin: string, href: string): string {
	const hashIndex = href.indexOf('#');
	const pathPart = hashIndex === -1 ? href : href.slice(0, hashIndex);
	const hash = hashIndex === -1 ? '' : href.slice(hashIndex);
	return `${pageUrl(siteOrigin, pathPart || '/')}${hash}`;
}

function siteNavigation(siteOrigin: string): JsonLdNode {
	const links = navCategories
		.flatMap((category) => category.items)
		.filter((item) => !item.external && item.href.startsWith('/'));

	return {
		'@type': 'ItemList',
		'@id': `${siteOrigin}/#site-navigation`,
		name: 'Main navigation',
		itemListElement: links.map((item, index) => ({
			'@type': 'ListItem',
			position: index + 1,
			item: {
				'@type': 'SiteNavigationElement',
				name: item.label,
				url: navUrl(siteOrigin, item.href),
			},
		})),
	};
}

function faqPage(canonical: string, faqs: FaqEntry[]): JsonLdNode {
	return {
		'@type': 'FAQPage',
		'@id': `${canonical}#faq`,
		url: canonical,
		mainEntity: faqs.map((faq) => ({
			'@type': 'Question',
			name: faq.question,
			acceptedAnswer: {
				'@type': 'Answer',
				text: faq.answer,
			},
		})),
	};
}

export function buildStructuredData({
	siteOrigin,
	pathname,
	canonical,
	faqs = [],
}: {
	siteOrigin: string;
	pathname: string;
	canonical: string;
	faqs?: FaqEntry[];
}): JsonLdNode {
	const origin = siteOrigin.replace(/\/$/, '');
	const path = normalizePath(pathname);
	const organizationId = `${origin}/#organization`;

	const graph: JsonLdNode[] = [
		{
			'@type': ['EducationalOrganization', 'School'],
			'@id': organizationId,
			name: 'Trinity Classical Academy',
			description:
				'Trinity Classical Academy partners with families in the joyful discipleship of students through rigorous, Christ-centered classical education.',
			url: `${origin}/`,
			logo: `${origin}/favicon-192.png`,
			email: 'info@trinityclassical.academy',
			address: {
				'@type': 'PostalAddress',
				streetAddress: '7160 Cahaba Valley Rd.',
				addressLocality: 'Birmingham',
				addressRegion: 'AL',
				postalCode: '35242',
				addressCountry: 'US',
			},
			parentOrganization: {
				'@type': 'Church',
				name: 'Trinity Presbyterian Church',
				url: 'https://trinitypresbham.com/',
			},
			sameAs: [
				'https://instagram.com/trinityclassicalacademy',
				'https://www.facebook.com/profile.php?id=61582574271980',
			],
		},
		{
			'@type': 'WebSite',
			'@id': `${origin}/#website`,
			name: 'Trinity Classical Academy',
			url: `${origin}/`,
			publisher: { '@id': organizationId },
		},
		siteNavigation(origin),
	];

	const breadcrumbs = breadcrumbList(origin, path, canonical);
	if (breadcrumbs) graph.push(breadcrumbs);

	if (path === '/faq' && faqs.length > 0) {
		graph.push(faqPage(canonical, faqs));
	}

	return {
		'@context': 'https://schema.org',
		'@graph': graph,
	};
}

export function serializeJsonLd(data: unknown): string {
	return JSON.stringify(data).replace(/</g, '\\u003c');
}
