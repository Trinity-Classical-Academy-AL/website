import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url);
const allowedTypes = new Set([
	'EducationalOrganization',
	'School',
	'WebSite',
	'ItemList',
	'ListItem',
	'SiteNavigationElement',
	'BreadcrumbList',
	'FAQPage',
	'Question',
	'Answer',
	'PostalAddress',
	'Church',
]);

const expectedCopy = {
	'index.html': {
		title: 'Trinity Classical Academy — Birmingham, AL',
		description:
			'ACCS-mentored classical Christian school in Birmingham, Alabama, under Trinity Presbyterian Church. Grades K–8, adding a grade each year toward K–12.',
	},
	'admissions/index.html': {
		title: 'Admissions — Trinity Classical Academy',
		description:
			'Admissions at Trinity Classical Academy: request an interview, meet with the school, and receive an invitation to apply.',
	},
	'careers/index.html': {
		title: 'Careers — Trinity Classical Academy',
		description:
			'Careers at Trinity Classical Academy: teachers who are mature in the Christian faith, gifted at teaching children, and enthusiastic for classical education.',
	},
	'contact/index.html': {
		title: 'Contact — Trinity Classical Academy',
		description:
			'Contact Trinity Classical Academy: email the school, ask a question, or schedule a visit at 7160 Cahaba Valley Rd., Birmingham, AL 35242.',
	},
	'curriculum/index.html': {
		title: 'Curriculum — Trinity Classical Academy',
		description:
			'Curriculum at Trinity Classical Academy: integrated humanities, Latin, music, art, logic, grammar, writing, phonics, geography, science, and mathematics.',
	},
	'faq/index.html': {
		title: 'FAQ — Trinity Classical Academy',
		description:
			'FAQ for Trinity Classical Academy: location, grades, uniform, classical education, accreditation, the school day, homework, and financial aid.',
	},
	'how-it-works/index.html': {
		title: 'How It Works — Trinity Classical Academy',
		description:
			'How Trinity Classical Academy works: small cohorts, mastery-based progression, and four days of classical instruction built around the rhythms of family life.',
	},
	'our-vision/index.html': {
		title: 'Our Vision — Trinity Classical Academy',
		description:
			'Our vision at Trinity Classical Academy: Christian formation in humanities, mathematics, Bible, science, history, literature, language, art, and music.',
	},
	'our-philosophy/index.html': {
		title: 'Our Philosophy — Trinity Classical Academy',
		description: 'The philosophy of education and subject statements of Trinity Classical Academy.',
	},
	'people/index.html': {
		title: 'People — Trinity Classical Academy',
		description:
			'People at Trinity Classical Academy: the board of directors, faculty, and leadership of this ministry of Trinity Presbyterian Church in Birmingham, Alabama.',
	},
	'resources/index.html': {
		title: 'Resources — Trinity Classical Academy',
		description:
			'Resources for Trinity Classical Academy families: tuition policy, uniform policy, academic calendar, curriculum guide, FAQ, and the parent portal.',
	},
	'resources/tuition/index.html': {
		title: 'Tuition — Trinity Classical Academy',
		description:
			'Tuition and fee policy for Trinity Classical Academy, including enrollment fees and payment schedules.',
	},
	'resources/uniform/index.html': {
		title: 'Uniform — Trinity Classical Academy',
		description:
			'Uniform policy for Trinity Classical Academy: required dress for every student, approved vendors, and dress code guidelines.',
	},
	'brand-guide/index.html': {
		title: 'Brand Guide — Trinity Classical Academy',
		description: 'Internal brand reference.',
	},
	'404.html': {
		title: 'Page not found — Trinity Classical Academy',
		description: 'The page you requested could not be found.',
	},
};

const htmlFiles = [];
const walk = (dir) => {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) walk(path);
		else if (entry.endsWith('.html')) htmlFiles.push(path);
	}
};
walk(dist.pathname);

const failures = [];
const fail = (message) => failures.push(message);

const decode = (value) =>
	value
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;|&#x27;/g, "'");

const attr = (html, pattern) => {
	const match = html.match(pattern);
	return match ? decode(match[1]) : null;
};

const visibleText = (html) =>
	html
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/\s+/g, ' ')
		.trim();

for (const file of htmlFiles) {
	const rel = file.slice(dist.pathname.length);
	const html = readFileSync(file, 'utf8');
	const expected = expectedCopy[rel];
	if (!expected) {
		fail(`${rel}: unexpected html file`);
		continue;
	}
	const title = attr(html, /<title>(.*?)<\/title>/s);
	const description = attr(html, /<meta name="description" content="(.*?)"/s);
	const canonical = attr(html, /<link rel="canonical" href="(.*?)"/s);
	if (title !== expected.title) fail(`${rel}: title changed to ${title}`);
	if (description !== expected.description) fail(`${rel}: description changed to ${description}`);
	if (!canonical?.startsWith('https://trinityclassical.academy')) {
		fail(`${rel}: canonical is not the production origin (${canonical})`);
	}

	const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => match[1]);
	if (blocks.length !== 1) fail(`${rel}: expected 1 JSON-LD block, found ${blocks.length}`);
	let data;
	try {
		data = JSON.parse(blocks[0] ?? '');
	} catch (error) {
		fail(`${rel}: JSON-LD is not well-formed (${error.message})`);
		continue;
	}
	if (data['@context'] !== 'https://schema.org') fail(`${rel}: @context is ${data['@context']}`);
	const walkNode = (value) => {
		if (!value || typeof value !== 'object') return;
		if (Array.isArray(value)) {
			value.forEach(walkNode);
			return;
		}
		if ('telephone' in value || 'foundingDate' in value) fail(`${rel}: invented organization fact`);
		const type = value['@type'];
		const list = Array.isArray(type) ? type : type ? [type] : [];
		for (const name of list) {
			if (!allowedTypes.has(name)) fail(`${rel}: unknown schema.org type ${name}`);
		}
		Object.values(value).forEach(walkNode);
	};
	walkNode(data);

	const nodes = data['@graph'] ?? [];
	const ofType = (name) => nodes.filter((node) => {
		const type = node['@type'];
		return type === name || (Array.isArray(type) && type.includes(name));
	});
	if (ofType('EducationalOrganization').length !== 1) fail(`${rel}: missing School node`);
	if (ofType('WebSite').length !== 1) fail(`${rel}: missing WebSite node`);
	if (ofType('ItemList').length !== 1) fail(`${rel}: missing navigation list`);
	const crumbs = ofType('BreadcrumbList');
	const isHome = rel === 'index.html';
	if (isHome && crumbs.length !== 0) fail('home: unexpected BreadcrumbList');
	if (!isHome && crumbs.length !== 1) fail(`${rel}: expected one BreadcrumbList`);
	if (!isHome) {
		const items = crumbs[0].itemListElement;
		if (items[0]?.name !== 'Home' || items[0]?.item !== 'https://trinityclassical.academy/') {
			fail(`${rel}: breadcrumb does not start at Home`);
		}
		const last = items.at(-1);
		if (last?.item !== canonical) fail(`${rel}: last breadcrumb ${last?.item} != canonical ${canonical}`);
		const positions = items.map((item) => item.position);
		if (positions.some((position, index) => position !== index + 1)) {
			fail(`${rel}: breadcrumb positions are not sequential`);
		}
	}
	const faqs = ofType('FAQPage');
	if (rel === 'faq/index.html') {
		if (faqs.length !== 1) fail('faq: missing FAQPage');
		else {
			const pageText = visibleText(html);
			for (const question of faqs[0].mainEntity) {
				if (!pageText.includes(question.name)) fail(`faq: question not on page: ${question.name}`);
				for (const line of question.acceptedAnswer.text.split('\n')) {
					if (!pageText.includes(line.trim())) fail(`faq: answer line not on page: ${line}`);
				}
			}
			if (faqs[0].mainEntity.length < 8) fail('faq: expected the on-page questions');
		}
	} else if (faqs.length !== 0) {
		fail(`${rel}: FAQPage is only for /faq`);
	}
}

const sitemap = readFileSync(new URL('../dist/sitemap-0.xml', import.meta.url), 'utf8');
const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
const required = [
	'https://trinityclassical.academy/',
	'https://trinityclassical.academy/admissions/',
	'https://trinityclassical.academy/careers/',
	'https://trinityclassical.academy/contact/',
	'https://trinityclassical.academy/curriculum/',
	'https://trinityclassical.academy/faq/',
	'https://trinityclassical.academy/how-it-works/',
	'https://trinityclassical.academy/our-vision/',
	'https://trinityclassical.academy/people/',
	'https://trinityclassical.academy/resources/',
	'https://trinityclassical.academy/resources/tuition/',
	'https://trinityclassical.academy/resources/uniform/',
];
for (const url of required) {
	if (!urls.includes(url)) fail(`sitemap missing ${url}`);
}
if (urls.some((url) => url.includes('/brand-guide') || url.includes('/our-philosophy'))) {
	fail('sitemap includes a noindex page');
}
const lastmods = [...sitemap.matchAll(/<lastmod>(.*?)<\/lastmod>/g)].map((match) => match[1]);
if (lastmods.length !== urls.length) fail('sitemap lastmod count does not match urls');
if (lastmods.some((value) => !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/.test(value))) {
	fail(`sitemap lastmod is not a date: ${lastmods}`);
}

const robots = readFileSync(new URL('../dist/robots.txt', import.meta.url), 'utf8');
if (!robots.includes('Sitemap: https://trinityclassical.academy/sitemap-index.xml')) {
	fail('robots.txt sitemap directive changed');
}
if (!robots.includes('Allow: /')) fail('robots.txt no longer allows crawling');

if (failures.length) {
	console.error(failures.join('\n'));
	process.exit(1);
}
console.log(`JSON-LD ok on ${htmlFiles.length} pages; sitemap has ${urls.length} urls with lastmod.`);
