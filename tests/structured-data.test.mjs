import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildStructuredData, normalizePath } from '../src/lib/structuredData.ts';

const ORIGIN = 'https://trinityclassical.academy';

const graph = (pathname, canonical = `${ORIGIN}${normalizePath(pathname) === '/' ? '/' : `${normalizePath(pathname)}/`}`, faqs) =>
	buildStructuredData({ siteOrigin: ORIGIN, pathname, canonical, faqs });

const types = (node) => {
	const found = [];
	const walk = (value) => {
		if (!value || typeof value !== 'object') return;
		if (Array.isArray(value)) {
			value.forEach(walk);
			return;
		}
		if (value['@type']) {
			const type = value['@type'];
			found.push(...(Array.isArray(type) ? type : [type]));
		}
		Object.values(value).forEach(walk);
	};
	walk(node);
	return found;
};

const find = (data, type) => data['@graph'].find((node) => {
	const nodeType = node['@type'];
	return nodeType === type || (Array.isArray(nodeType) && nodeType.includes(type));
});

test('home graph is organization, website, and main nav only', () => {
	const data = graph('/');
	assert.equal(data['@context'], 'https://schema.org');
	assert.deepEqual(
		data['@graph'].map((node) => node['@type']),
		[['EducationalOrganization', 'School'], 'WebSite', 'ItemList'],
	);
	assert.equal(find(data, 'BreadcrumbList'), undefined);
	assert.equal(find(data, 'FAQPage'), undefined);

	const school = find(data, 'EducationalOrganization');
	assert.equal(school.name, 'Trinity Classical Academy');
	assert.equal(school.url, `${ORIGIN}/`);
	assert.equal(school.logo, `${ORIGIN}/favicon-192.png`);
	assert.equal(school.address.streetAddress, '7160 Cahaba Valley Rd.');
	assert.equal(school.address.addressLocality, 'Birmingham');
	assert.equal(school.address.addressRegion, 'AL');
	assert.equal(school.address.postalCode, '35242');
	assert.equal(school.parentOrganization.name, 'Trinity Presbyterian Church');
	assert.equal(school.parentOrganization.url, 'https://trinitypresbham.com/');
	assert.deepEqual(school.sameAs, [
		'https://instagram.com/trinityclassicalacademy',
		'https://www.facebook.com/profile.php?id=61582574271980',
	]);
	assert.equal(JSON.stringify(data).includes('telephone'), false);
	assert.equal(JSON.stringify(data).includes('foundingDate'), false);
});

test('main nav structured data matches internal header links', () => {
	const nav = find(graph('/'), 'ItemList');
	const entries = nav.itemListElement.map((entry) => ({
		position: entry.position,
		name: entry.item.name,
		url: entry.item.url,
		type: entry.item['@type'],
	}));
	assert.deepEqual(entries, [
		{ position: 1, type: 'SiteNavigationElement', name: 'Our Vision', url: `${ORIGIN}/#our-vision` },
		{ position: 2, type: 'SiteNavigationElement', name: 'How It Works', url: `${ORIGIN}/how-it-works/` },
		{ position: 3, type: 'SiteNavigationElement', name: 'Curriculum', url: `${ORIGIN}/curriculum/` },
		{ position: 4, type: 'SiteNavigationElement', name: 'People', url: `${ORIGIN}/people/` },
		{ position: 5, type: 'SiteNavigationElement', name: 'Admissions Process', url: `${ORIGIN}/admissions/` },
		{ position: 6, type: 'SiteNavigationElement', name: 'Resources', url: `${ORIGIN}/resources/` },
		{ position: 7, type: 'SiteNavigationElement', name: 'FAQ', url: `${ORIGIN}/faq/` },
		{ position: 8, type: 'SiteNavigationElement', name: 'Tuition Policy', url: `${ORIGIN}/resources/tuition/` },
		{ position: 9, type: 'SiteNavigationElement', name: 'Uniform Policy', url: `${ORIGIN}/resources/uniform/` },
		{ position: 10, type: 'SiteNavigationElement', name: 'Careers', url: `${ORIGIN}/careers/` },
		{ position: 11, type: 'SiteNavigationElement', name: 'Contact', url: `${ORIGIN}/contact/` },
	]);
});

test('tuition breadcrumbs follow the url hierarchy', () => {
	const crumbs = find(graph('/resources/tuition/'), 'BreadcrumbList').itemListElement;
	assert.deepEqual(
		crumbs.map((crumb) => [crumb.position, crumb.name, crumb.item]),
		[
			[1, 'Home', `${ORIGIN}/`],
			[2, 'Resources', `${ORIGIN}/resources/`],
			[3, 'Tuition', `${ORIGIN}/resources/tuition/`],
		],
	);
});

test('faq schema uses the supplied on-page question and answer text', () => {
	const faqs = [
		{ question: 'Where is your school located?', answer: 'Trinity Classical Academy meets at 7160 Cahaba Valley Rd., Birmingham.' },
		{ question: 'What does a typical school day look like?', answer: 'A typical day at Trinity begins and ends with intention.\n7:55 AM — Drop-off' },
	];
	const data = graph('/faq/', `${ORIGIN}/faq/`, faqs);
	const page = find(data, 'FAQPage');
	assert.equal(page.url, `${ORIGIN}/faq/`);
	assert.equal(page.mainEntity[0].name, faqs[0].question);
	assert.equal(page.mainEntity[0].acceptedAnswer.text, faqs[0].answer);
	assert.equal(page.mainEntity[1].acceptedAnswer.text, faqs[1].answer);
	assert.equal(find(graph('/admissions/', `${ORIGIN}/admissions/`, faqs), 'FAQPage'), undefined);
});
