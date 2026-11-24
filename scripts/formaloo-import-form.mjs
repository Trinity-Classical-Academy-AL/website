// Copy a Formaloo form's questions into a DRAFT portal form (default purpose: the
// full application). Reads Formaloo; writes only one new draft school_forms row.
// Nothing is emailed or published: review the draft in Admin → Documents & forms → Forms.
//
//   FORMALOO_API_KEY=… FORMALOO_API_SECRET=… DATABASE_URL=… \
//     node scripts/formaloo-import-form.mjs <form slug | formaloo.me link> [--purpose application|contract|general] [--dry-run]
//
// --dry-run prints the mapped questions and writes nothing (DATABASE_URL not needed).
const args = process.argv.slice(2);
const target = args.find((arg) => !arg.startsWith('--'));
const dryRun = args.includes('--dry-run');
const purpose = args[args.indexOf('--purpose') + 1] && args.includes('--purpose') ? args[args.indexOf('--purpose') + 1] : 'application';
const key = process.env.FORMALOO_API_KEY, secret = process.env.FORMALOO_API_SECRET;
if (!target) { console.error('Usage: node scripts/formaloo-import-form.mjs <form slug | formaloo.me link> [--purpose application] [--dry-run]'); process.exit(1); }
if (!key || !secret) { console.error('Set FORMALOO_API_KEY and FORMALOO_API_SECRET.'); process.exit(1); }
if (!['application', 'contract', 'general', 'reenrollment'].includes(purpose)) { console.error(`Unknown purpose: ${purpose}`); process.exit(1); }

const tokenBody = new FormData(); tokenBody.set('grant_type', 'client_credentials');
const tokenResponse = await fetch('https://api.formaloo.me/v3.0/oauth2/authorization-token/', { method: 'POST', headers: { 'x-api-key': key, Authorization: `Basic ${secret}` }, body: tokenBody });
if (!tokenResponse.ok) { console.error(`Formaloo authorization failed (${tokenResponse.status}).`); process.exit(1); }
const token = (await tokenResponse.json()).authorization_token;
const get = async (path) => {
	const response = await fetch(`https://api.formaloo.me/v3.0/${path}`, { headers: { 'x-api-key': key, Authorization: `JWT ${token}` } });
	return response.ok ? (await response.json()).data : null;
};

// A link (https://….formaloo.me/tqo8fo) gives the form's address; the API wants its slug.
const ident = target.replace(/\/+$/, '').split('/').pop();
let form = (await get(`forms/${ident}/`))?.form;
if (!form) {
	for (let page = 1; page <= 20 && !form; page++) {
		const list = await get(`forms/?page_size=100&page=${page}`);
		const forms = list?.forms ?? [];
		form = forms.find((item) => item.address === ident || item.slug === ident);
		if (form) form = (await get(`forms/${form.slug}/`))?.form ?? form;
		if (!list?.next) break;
	}
}
if (!form) { console.error(`No Formaloo form found for "${ident}". Pass its slug or its formaloo.me link.`); process.exit(1); }

// Formaloo field types → the portal's question types (short, long, yesno, choice, date, phone, file).
const TYPE = {
	short_text: 'short', email: 'short', number: 'short', website: 'short', city: 'short', country: 'short', national_code: 'short',
	long_text: 'long', paragraph: 'long',
	yes_no: 'yesno', boolean: 'yesno', consent: 'yesno', signature: 'long',
	choice: 'choice', dropdown: 'choice', multiple_select: 'choice', multiple_choice: 'choice',
	date: 'date', datetime: 'date', time: 'short',
	phone: 'phone', phone_number: 'phone',
	file: 'file', image: 'file',
};
const SKIP = new Set(['section', 'meta', 'variable', 'hidden', 'page_break', 'repeating_section', 'table', 'matrix', 'video', 'image_choice']);
const plain = (value) => String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const questions = [], skipped = [];
for (const field of form.fields_list ?? []) {
	const label = plain(field.title).slice(0, 200);
	if (!label) continue;
	if (SKIP.has(field.type) || !TYPE[field.type]) { skipped.push(`${field.type}: ${label}`); continue; }
	const type = TYPE[field.type];
	const options = type === 'choice' ? (field.choice_items ?? field.choices ?? []).map((item) => plain(item.title)).filter(Boolean).slice(0, 20) : undefined;
	questions.push({ id: '', label, type: type === 'choice' && !options?.length ? 'short' : type, required: !!field.required, ...(options?.length ? { options } : {}) });
}

console.log(`${form.title} (${form.address ?? form.slug}): ${questions.length} questions, ${skipped.length} skipped.`);
for (const question of questions) console.log(`  [${question.type}]${question.required ? '*' : ' '} ${question.label}${question.options ? `  {${question.options.join(' / ')}}` : ''}`);
if (skipped.length) { console.log('Skipped (rebuild by hand if needed):'); for (const line of skipped) console.log(`  ${line}`); }
if (dryRun) process.exit(0);

if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL to write the draft (or pass --dry-run).'); process.exit(1); }
const { saveSchoolForm } = await import('@tca/school');
const result = await saveSchoolForm({
	title: plain(form.title).slice(0, 160) || 'Full application',
	instructions: plain(form.description).slice(0, 2000),
	audience: 'everyone', grade: '', dueOn: '', questions, publish: false, purpose,
});
if (!result.ok) { console.error(result.error); process.exit(1); }
console.log(`Draft form saved (${result.id}). Review and publish it in Admin → Documents & forms → Forms.`);
process.exit(0);
