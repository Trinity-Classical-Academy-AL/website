// Read-only: print the choices of the Formaloo interview form's status fields and
// how many submissions use each. Prints no keys and no submitter details.
// Needs FORMALOO_API_KEY and FORMALOO_API_SECRET in the environment.
const key = process.env.FORMALOO_API_KEY, secret = process.env.FORMALOO_API_SECRET;
if (!key || !secret) { console.error('Set FORMALOO_API_KEY and FORMALOO_API_SECRET.'); process.exit(1); }
const FORM = 'JRqlqXml';
const FIELDS = { tARX8tnm: 'Staff status', hoSng53c: 'Enrollment status' };

const tokenBody = new FormData(); tokenBody.set('grant_type', 'client_credentials');
const tokenResponse = await fetch('https://api.formaloo.me/v3.0/oauth2/authorization-token/', { method: 'POST', headers: { 'x-api-key': key, Authorization: `Basic ${secret}` }, body: tokenBody });
if (!tokenResponse.ok) { console.error(`Authorization failed (${tokenResponse.status})`); process.exit(1); }
const token = (await tokenResponse.json()).authorization_token;
const get = async (path) => {
	const response = await fetch(`https://api.formaloo.me/v3.0/${path}`, { headers: { 'x-api-key': key, Authorization: `JWT ${token}` } });
	if (!response.ok) throw new Error(`${path} failed (${response.status})`);
	return (await response.json()).data;
};

const form = (await get(`forms/${FORM}/`)).form;
const fields = form.fields_list || form.fields || [];
const counts = Object.fromEntries(Object.keys(FIELDS).map((slug) => [slug, {}]));
for (let page = 1; page <= 100; page++) {
	const data = await get(`forms/${FORM}/rows/?page_size=100&page=${page}`);
	for (const row of data.rows || []) for (const slug of Object.keys(FIELDS)) {
		const value = row.data?.[slug];
		const choice = typeof value === 'string' ? value : value?.slug || '(blank)';
		counts[slug][choice] = (counts[slug][choice] || 0) + 1;
	}
	if (!data.next) break;
}
for (const [slug, name] of Object.entries(FIELDS)) {
	const field = fields.find((item) => item.slug === slug);
	console.log(`\n${name} (${field?.title ?? slug})${field?.type ? `, ${field.type}` : ''}`);
	for (const choice of field?.choice_items || field?.choices || []) {
		console.log(`  ${String(choice.slug).padEnd(10)} ${String(counts[slug][choice.slug] || 0).padStart(4)}  ${choice.title}`);
	}
	console.log(`  ${'(blank)'.padEnd(10)} ${String(counts[slug]['(blank)'] || 0).padStart(4)}`);
}
