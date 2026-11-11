import { randomUUID } from 'node:crypto';
import { db, dbReady } from './db.ts';
import { sendEmail } from './email.ts';
import { routeEmail } from './accounts.ts';
import { saveFlyerBytes, readFlyerBytes } from './flyers.ts';
import { csvResponse, toCsv } from './csv.ts';

export type DocAudience = 'everyone' | 'grade' | 'family';
export type Question = { id: string; label: string; type: string; required: boolean };

const DOC_BYTES = 25 * 1024 * 1024;
const DOC_TYPES = new Set(['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png', 'image/webp']);

type FamilyView = { id: string; roles: string[] };
type StudentView = { id: string; name: string; grade: string };

export async function familyStudents(familyId: string): Promise<StudentView[]> {
	await dbReady();
	const rows = await db()`select id, name, grade from students where family_id = ${familyId} order by name`;
	return rows.map((row) => ({ id: String(row.id), name: String(row.name), grade: String(row.grade) }));
}

function seesDoc(doc: { audience: string; grade: string; familyId: string }, family: FamilyView, students: StudentView[]) {
	if (!family.roles.includes('guardian') && !family.roles.includes('admin')) return false;
	if (doc.audience === 'family') return doc.familyId === family.id;
	if (doc.audience === 'grade') return students.some((student) => student.grade === doc.grade);
	return doc.audience === 'everyone';
}

export async function listGuardianDocuments(family: FamilyView, query = '') {
	await dbReady();
	const students = await familyStudents(family.id);
	const rows = await db()`
		select id, title, category, audience, grade, family_id, file_name, content_type, file_size, updated_at
		from school_documents where status = 'published' order by category, title
	`;
	const needle = query.trim().toLowerCase();
	return rows
		.map((row) => ({
			id: String(row.id),
			title: String(row.title),
			category: String(row.category),
			audience: String(row.audience),
			grade: String(row.grade),
			familyId: row.family_id ? String(row.family_id) : '',
			fileName: String(row.file_name),
			contentType: String(row.content_type),
			size: Number(row.file_size),
			updatedAt: row.updated_at ? new Date(row.updated_at as string | Date).toISOString() : '',
		}))
		.filter((doc) => seesDoc(doc, family, students))
		.filter((doc) => !needle || `${doc.title} ${doc.category}`.toLowerCase().includes(needle));
}

export async function readGuardianDocument(family: FamilyView, id: string) {
	const docs = await listGuardianDocuments(family);
	return docs.find((doc) => doc.id === id) || null;
}

export async function readDocumentBytes(family: FamilyView, id: string) {
	const doc = await readGuardianDocument(family, id);
	if (!doc) return null;
	const rows = await db()`select file_key from school_documents where id = ${id}`;
	const file = await readFlyerBytes(String(rows[0]?.file_key || ''));
	if (!file) return null;
	return { ...file, title: doc.title };
}

export async function saveSchoolDocument(input: {
	id?: string;
	title: string;
	category: string;
	audience: DocAudience;
	grade: string;
	familyId: string;
	publish: boolean;
	file?: { bytes: Uint8Array; name: string; contentType: string };
	email: boolean;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
	await dbReady();
	const title = input.title.trim().slice(0, 160);
	if (!title) return { ok: false, error: 'Add a title.' };
	if (input.audience === 'grade' && !input.grade) return { ok: false, error: 'Choose a grade.' };
	if (input.audience === 'family' && !input.familyId) return { ok: false, error: 'Choose a family.' };
	let fileKey = '';
	let fileName = '';
	let contentType = '';
	let size = 0;
	if (input.file && input.file.bytes.byteLength) {
		if (input.file.bytes.byteLength > DOC_BYTES) return { ok: false, error: 'Files must be 25 MB or smaller.' };
		if (!DOC_TYPES.has(input.file.contentType)) return { ok: false, error: 'Use a PDF, Word, JPG, or PNG.' };
		const saved = await saveFlyerBytes(input.file.bytes, { name: input.file.name, contentType: input.file.contentType }, 'doc');
		fileKey = saved.key;
		fileName = saved.name;
		contentType = saved.contentType;
		size = saved.size;
	}
	const id = input.id || randomUUID();
	const status = input.publish ? 'published' : 'draft';
	if (input.id) {
		await db()`
			update school_documents set title = ${title}, category = ${input.category}, audience = ${input.audience},
				grade = ${input.grade}, family_id = ${input.familyId || null}, status = ${status}, updated_at = now(),
				file_key = case when ${fileKey} = '' then file_key else ${fileKey} end,
				file_name = case when ${fileName} = '' then file_name else ${fileName} end,
				content_type = case when ${contentType} = '' then content_type else ${contentType} end,
				file_size = case when ${size} = 0 then file_size else ${size} end
			where id = ${id}
		`;
	} else {
		if (!fileKey) return { ok: false, error: 'Choose a file.' };
		await db()`
			insert into school_documents (id, title, category, audience, grade, family_id, status, file_key, file_name, content_type, file_size)
			values (${id}, ${title}, ${input.category}, ${input.audience}, ${input.grade}, ${input.familyId || null}, ${status}, ${fileKey}, ${fileName}, ${contentType}, ${size})
		`;
	}
	if (input.publish && input.email) await emailDocument(id, title);
	return { ok: true, id };
}

async function emailDocument(id: string, title: string) {
	const guardians = await db()`select id, email from families where 'guardian' = any(roles)`;
	for (const guardian of guardians) {
		await sendEmail({
			to: await routeEmail(String(guardian.id), 'announcements', String(guardian.email)),
			subject: `New document: ${title}`,
			text: `${title} is in your TCA Portal documents.\n`,
		});
	}
}

export async function listAdminDocuments() {
	await dbReady();
	const rows = await db()`select id, title, category, audience, grade, status, file_name, updated_at from school_documents order by updated_at desc`;
	return rows.map((row) => ({
		id: String(row.id),
		title: String(row.title),
		category: String(row.category),
		audience: String(row.audience),
		grade: String(row.grade),
		status: String(row.status),
		fileName: String(row.file_name),
		updatedAt: row.updated_at ? new Date(row.updated_at as string | Date).toISOString() : '',
	}));
}

export async function deleteSchoolDocument(id: string) {
	await dbReady();
	await db()`delete from school_documents where id = ${id}`;
}

export async function saveSchoolForm(input: {
	id?: string;
	title: string;
	instructions: string;
	audience: string;
	grade: string;
	dueOn: string;
	questions: Question[];
	publish: boolean;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
	await dbReady();
	const title = input.title.trim().slice(0, 160);
	if (!title) return { ok: false, error: 'Add a title.' };
	const questions = input.questions.filter((question) => question.label.trim()).map((question) => ({ ...question, id: question.id || randomUUID(), label: question.label.trim().slice(0, 200) }));
	if (input.publish && questions.length === 0) return { ok: false, error: 'Add a question.' };
	const id = input.id || randomUUID();
	const status = input.publish ? 'open' : 'draft';
	const due = /^\d{4}-\d{2}-\d{2}$/.test(input.dueOn) ? input.dueOn : null;
	if (input.id) {
		await db()`update school_forms set title = ${title}, instructions = ${input.instructions}, audience = ${input.audience}, grade = ${input.grade}, due_on = ${due}, status = ${status}, questions = ${JSON.stringify(questions)}::jsonb where id = ${id}`;
	} else {
		await db()`insert into school_forms (id, title, instructions, audience, grade, due_on, status, questions) values (${id}, ${title}, ${input.instructions}, ${input.audience}, ${input.grade}, ${due}, ${status}, ${JSON.stringify(questions)}::jsonb)`;
	}
	if (input.publish) await assignForm(id);
	return { ok: true, id };
}

async function assignForm(formId: string) {
	const forms = await db()`select audience, grade from school_forms where id = ${formId}`;
	const form = forms[0];
	if (!form) return;
	const students = await db()`select s.id, s.family_id, s.grade from students s join families f on f.id = s.family_id where 'guardian' = any(f.roles)`;
	for (const student of students) {
		if (form.audience === 'grade' && String(student.grade) !== String(form.grade)) continue;
		if (form.audience === 'family') continue;
		await db()`
			insert into form_assignments (id, form_id, family_id, student_id)
			values (${randomUUID()}, ${formId}, ${student.family_id}, ${student.id})
			on conflict (form_id, family_id, student_id) do nothing
		`;
	}
}

export async function listAdminForms() {
	await dbReady();
	const rows = await db()`
		select f.id, f.title, f.audience, f.grade, f.due_on::text as due_on, f.status,
			(select count(*) from form_assignments a where a.form_id = f.id and a.status = 'submitted')::int as submitted,
			(select count(*) from form_assignments a where a.form_id = f.id)::int as total
		from school_forms f order by f.created_at desc
	`;
	return rows.map((row) => ({
		id: String(row.id),
		title: String(row.title),
		audience: String(row.audience),
		grade: String(row.grade),
		dueOn: String(row.due_on || ''),
		status: String(row.status),
		submitted: Number(row.submitted),
		total: Number(row.total),
	}));
}

export async function formTracker(formId: string) {
	await dbReady();
	const forms = await db()`select id, title, audience, grade, due_on::text as due_on, questions, instructions from school_forms where id = ${formId}`;
	const form = forms[0];
	if (!form) return null;
	const rows = await db()`
		select a.id, a.status, a.submitted_at, a.signature_name, a.answers, s.name as student, s.grade, f.name as family
		from form_assignments a
		left join students s on s.id = a.student_id
		join families f on f.id = a.family_id
		where a.form_id = ${formId}
		order by s.name
	`;
	return {
		id: String(form.id),
		title: String(form.title),
		audience: String(form.audience),
		grade: String(form.grade),
		dueOn: String(form.due_on || ''),
		questions: (form.questions || []) as Question[],
		rows: rows.map((row) => ({
			id: String(row.id),
			status: String(row.status),
			student: String(row.student || 'Family'),
			grade: String(row.grade || ''),
			family: String(row.family || ''),
			signature: String(row.signature_name || ''),
			submittedAt: row.submitted_at ? new Date(row.submitted_at as string | Date).toISOString() : '',
			answers: (row.answers || {}) as Record<string, string>,
		})),
	};
}

export async function remindForm(formId: string): Promise<number> {
	await dbReady();
	const form = await db()`select title, due_on::text as due_on from school_forms where id = ${formId}`;
	const missing = await db()`
		select a.id, a.family_id, f.email from form_assignments a
		join families f on f.id = a.family_id
		where a.form_id = ${formId} and a.status <> 'submitted'
	`;
	for (const row of missing) {
		await sendEmail({
			to: await routeEmail(String(row.family_id), 'announcements', String(row.email)),
			subject: `Form still needed: ${form[0]?.title || 'A school form'}`,
			text: `Please finish ${form[0]?.title || 'the form'}${form[0]?.due_on ? ` by ${form[0].due_on}` : ''} in the TCA Portal.\n`,
		});
		await db()`update form_assignments set reminded_at = now() where id = ${row.id}`;
	}
	return missing.length;
}

export function trackerCsv(tracker: NonNullable<Awaited<ReturnType<typeof formTracker>>>) {
	return csvResponse(`${tracker.title}.csv`, toCsv(tracker.rows, [
		{ key: 'student', label: 'Student' },
		{ key: 'family', label: 'Family' },
		{ key: 'grade', label: 'Grade' },
		{ key: 'status', label: 'Status' },
		{ key: 'submittedAt', label: 'Submitted' },
		{ key: 'signature', label: 'Signature' },
	]));
}

export async function guardianForms(familyId: string) {
	await dbReady();
	const rows = await db()`
		select a.id, a.status, a.answers, a.signature_name, a.submitted_at, f.title, f.due_on::text as due_on, f.questions, f.instructions, s.name as student
		from form_assignments a
		join school_forms f on f.id = a.form_id
		left join students s on s.id = a.student_id
		where a.family_id = ${familyId} and f.status = 'open'
		order by f.due_on nulls last, f.title
	`;
	return rows.map((row) => ({
		id: String(row.id),
		status: String(row.status),
		title: String(row.title),
		dueOn: String(row.due_on || ''),
		student: String(row.student || 'Your family'),
		instructions: String(row.instructions || ''),
		questions: (row.questions || []) as Question[],
		answers: (row.answers || {}) as Record<string, string>,
		signature: String(row.signature_name || ''),
		submittedAt: row.submitted_at ? new Date(row.submitted_at as string | Date).toISOString() : '',
	}));
}

export async function saveAssignment(input: { familyId: string; id: string; answers: Record<string, string>; signature: string; confirm: boolean; submit: boolean }): Promise<{ ok: true } | { ok: false; error: string; fields: string[] }> {
	await dbReady();
	const rows = await db()`
		select a.id, f.questions from form_assignments a join school_forms f on f.id = a.form_id
		where a.id = ${input.id} and a.family_id = ${input.familyId} and a.status <> 'submitted'
	`;
	if (!rows[0]) return { ok: false, error: 'That form is not open for your family.', fields: [] };
	const questions = (rows[0].questions || []) as Question[];
	const fields: string[] = [];
	if (input.submit) {
		for (const question of questions) {
			if (question.required && !String(input.answers[question.id] || '').trim()) fields.push(question.id);
		}
		if (!input.signature.trim()) fields.push('signature');
		if (!input.confirm) fields.push('confirm');
		if (fields.length) {
			await db()`update form_assignments set answers = ${JSON.stringify(input.answers)}::jsonb, signature_name = ${input.signature}, status = 'draft' where id = ${input.id}`;
			return { ok: false, error: `Fix ${fields.length} ${fields.length === 1 ? 'thing' : 'things'} before you submit. Your answers are saved as a draft.`, fields };
		}
		await db()`update form_assignments set answers = ${JSON.stringify(input.answers)}::jsonb, signature_name = ${input.signature}, status = 'submitted', signed_at = now(), submitted_at = now() where id = ${input.id}`;
		return { ok: true };
	}
	await db()`update form_assignments set answers = ${JSON.stringify(input.answers)}::jsonb, signature_name = ${input.signature}, status = 'draft' where id = ${input.id}`;
	return { ok: true };
}

export async function featuredEvent() {
	await dbReady();
	const rows = await db()`
		select id, title, description, starts_at, ends_at, location, rsvp_url, flyer_key, flyer_name
		from events where feature_popup = true order by starts_at limit 1
	`;
	const row = rows[0];
	if (!row) return null;
	return {
		id: String(row.id),
		title: String(row.title),
		description: String(row.description || ''),
		startsAt: new Date(row.starts_at as string | Date).toISOString(),
		endsAt: row.ends_at ? new Date(row.ends_at as string | Date).toISOString() : '',
		location: String(row.location || ''),
		rsvpUrl: String(row.rsvp_url || ''),
		flyerKey: String(row.flyer_key || ''),
		flyerName: String(row.flyer_name || ''),
	};
}

export async function websiteEvents() {
	await dbReady();
	const rows = await db()`select id, title, description, starts_at, location from events where show_on_website = true and starts_at >= now() - interval '1 day' order by starts_at`;
	return rows.map((row) => ({ id: String(row.id), title: String(row.title), description: String(row.description || ''), startsAt: new Date(row.starts_at as string | Date).toISOString(), location: String(row.location || '') }));
}
