import type { APIRoute } from 'astro';
import { booksExportCsv, booksExportRows, chicagoToday, csvResponse, markEntriesExported } from '@tca/school';
import { csrfOk } from '../../lib/security.ts';

export const prerender = false;
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** The QuickBooks CSV for a date range. GET only reads; a CSRF-checked POST may also mark the rows exported. */
async function exportCsv(params: { from: string; to: string; onlyNew: boolean; mark: boolean }) {
	const today = chicagoToday();
	const from = isDate(params.from) ? params.from : `${today.slice(0, 8)}01`;
	const to = isDate(params.to) ? params.to : today;
	const { rows, ids } = await booksExportRows({ from, to, onlyNew: params.onlyNew });
	if (params.mark) await markEntriesExported(ids);
	return csvResponse(`tca-quickbooks-${from}-to-${to}.csv`, booksExportCsv(rows));
}

export const GET: APIRoute = async ({ url, locals }) => {
	if (!locals.roles.includes('finance')) return new Response('Not found', { status: 404 });
	return exportCsv({ from: url.searchParams.get('from') ?? '', to: url.searchParams.get('to') ?? '', onlyNew: url.searchParams.get('onlyNew') === '1', mark: false });
};

export const POST: APIRoute = async ({ request, cookies, locals }) => {
	if (!locals.roles.includes('finance')) return new Response('Not found', { status: 404 });
	const form = await request.formData();
	if (!csrfOk(cookies, form)) return new Response('That request expired. Go back and try again.', { status: 403 });
	return exportCsv({ from: String(form.get('from') ?? ''), to: String(form.get('to') ?? ''), onlyNew: form.get('onlyNew') === 'on', mark: form.get('mark') === 'on' });
};
