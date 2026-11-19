import type { AstroGlobal } from 'astro';
import { runActions, redirectOnSuccess, toastFrom } from '../actions.ts';
import { csrfToken } from '../security.ts';
import { parseUsDate } from '../fields.ts';
import { deleteSchoolDocument, listAdminDocuments, listAdminForms, listFamilies, saveSchoolDocument, saveSchoolForm } from '@tca/school';

/** Load data, run the existing actions, then derive the page's render model. */
export async function loadDocuments(Astro: AstroGlobal, family: NonNullable<AstroGlobal['locals']['family']>) {
	const secure = Astro.url.protocol === 'https:';
	const csrf = csrfToken(Astro.cookies, secure);
	const tab = Astro.url.searchParams.get('tab') === 'forms' ? 'forms' : 'documents';
	let error = '';
	const actionResult = await runActions(Astro, {
		'delete-doc': async (form) => {
			await deleteSchoolDocument(String(form.get('id') ?? ''));
			return { redirect: '/admin/documents?removed=1' };
		},
		form: async (form) => {
			const labels = form.getAll('qlabel').map(String);
			const types = form.getAll('qtype').map(String);
			const required = new Set(form.getAll('qreq').map(String));
			const result = await saveSchoolForm({
				id: String(form.get('id') ?? '') || undefined,
				title: String(form.get('title') ?? ''),
				instructions: String(form.get('instructions') ?? ''),
				audience: String(form.get('audience') ?? 'everyone'),
				grade: String(form.get('grade') ?? ''),
				dueOn: parseUsDate(String(form.get('due') ?? '')),
				questions: labels.map((label, index) => ({ id: '', label, type: types[index] || 'short', required: required.has(String(index)) })),
				publish: String(form.get('publish') ?? '') === 'yes',
			});
			return redirectOnSuccess(result, result => `/admin/documents?tab=forms&saved=${result.id}`);
		},
	}, {
		fallback: async (form) => {
			const file = form.get('file');
			const upload = file instanceof File && file.size ? { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name, contentType: file.type || 'application/pdf' } : undefined;
			const audience = String(form.get('audience') ?? 'everyone');
			const result = await saveSchoolDocument({
				id: String(form.get('id') ?? '') || undefined,
				title: String(form.get('title') ?? ''),
				category: String(form.get('category') ?? 'Letters'),
				audience: audience === 'grade' || audience === 'family' ? audience : 'everyone',
				grade: String(form.get('grade') ?? ''),
				familyId: String(form.get('familyId') ?? ''),
				publish: String(form.get('publish') ?? '') === 'yes',
				email: form.get('email') === 'on',
				file: upload,
			});
			return redirectOnSuccess(result, result => `/admin/documents?saved=${result.id}`);
		},
	});
	
	if ('redirect' in actionResult) return Astro.redirect(actionResult.redirect, actionResult.status);
	error = actionResult.error;
	const [docs, forms, families] = await Promise.all([
		listAdminDocuments(),
		tab === 'forms' || Astro.url.searchParams.get('sheet') === 'form' ? listAdminForms() : Promise.resolve([]),
		listFamilies(''),
	]);
	const editing = docs.find((doc) => doc.id === Astro.url.searchParams.get('doc'));
	const sheet = Astro.url.searchParams.get('sheet');
	const categories = ['Handbooks and policies', 'Calendars', 'Supply lists', 'Report cards', 'Letters', 'Forms and info'];
	const grades = ['K', '1', '2', '3', '4', '5', '6', '7', '8'];
	const toast = toastFrom(Astro.url, { saved: tab === 'forms' ? 'Form saved.' : 'Document published.' });
	return { family, csrf, tab, error, docs, forms, families, editing, sheet, categories, grades, toast };
}

export type DocumentsView = Exclude<Awaited<ReturnType<typeof loadDocuments>>, Response>;
