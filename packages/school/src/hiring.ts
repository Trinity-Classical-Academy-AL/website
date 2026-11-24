import { randomUUID } from 'node:crypto';
import { db, dbReady } from './db.ts';
import { notifyStaff, portalOrigin } from './email.ts';
import { sendTemplate } from './email-catalog.ts';
import { grantAccess, personEmails } from './access.ts';
import { readFlyerBytes, saveFlyerBytes } from './flyers.ts';
import type { Result } from './result.ts';

/**
 * Teacher hiring. A candidate applies from their portal account (with a CV), the school sends the
 * full application, one admin holds a video lesson interview, the board
 * interviews, and the board decides. Every reviewer can leave a recommendation
 * (yes / maybe / no) with a note; the Deciding stage reads the tally. Hiring a
 * candidate gives them Teacher access in the portal.
 */
export const HIRING_STAGES = [
	{ value: 'applied', label: 'Applied' },
	{ value: 'full_application', label: 'Full application' },
	{ value: 'video_lesson', label: 'Video lesson' },
	{ value: 'board_interview', label: 'Board interview' },
	{ value: 'deciding', label: 'Deciding' },
	{ value: 'hired', label: 'Hired' },
	{ value: 'declined', label: 'Not moving forward' },
	{ value: 'withdrawn', label: 'Withdrew' },
] as const;
export type HiringStage = (typeof HIRING_STAGES)[number]['value'];
export const HIRING_PIPELINE: HiringStage[] = ['applied', 'full_application', 'video_lesson', 'board_interview', 'deciding', 'hired'];
export const HIRING_CLOSED: HiringStage[] = ['declined', 'withdrawn'];
export const hiringStageLabel = (stage: string) => HIRING_STAGES.find((item) => item.value === stage)?.label ?? stage;
export const RECOMMENDATIONS = [
	{ value: 'yes', label: 'Hire' },
	{ value: 'maybe', label: 'Unsure' },
	{ value: 'no', label: 'Don’t hire' },
] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number]['value'];


export const APPLICANT_FILE_KINDS = [
	{ value: 'cv', label: 'CV or résumé' },
	{ value: 'cover', label: 'Cover letter' },
	{ value: 'other', label: 'Other' },
] as const;
export type ApplicantFile = { kind: string; key: string; name: string };
const FILE_BYTES = 15 * 1024 * 1024;

export type ApplicantNote = { id: string; at: string; by: string; kind: 'note' | 'recommendation' | 'stage' | 'email'; recommendation: Recommendation | null; note: string };
export type TeacherApplicant = {
	id: string; createdAt: string; updatedAt: string; status: HiringStage; name: string; email: string; phone: string;
	position: string; church: string; experience: string; statement: string; resumeUrl: string; source: string;
	videoWith: string; videoAt: string | null; boardAt: string | null;
	familyId: string | null; files: ApplicantFile[];
	/** Latest recommendation from each reviewer. */
	tally: { yes: number; maybe: number; no: number };
};

const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const clip = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max);
const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null);

async function log(applicantId: string, by: string, kind: ApplicantNote['kind'], note: string, recommendation: Recommendation | null = null): Promise<void> {
	await db()`insert into teacher_applicant_notes (id, applicant_id, by, kind, recommendation, note) values (${randomUUID()}, ${applicantId}, ${by}, ${kind}, ${recommendation}, ${note})`;
}

/**
 * A candidate applies from their portal account (familyId), with their CV
 * (required) and optionally a cover letter and one more file. Imports from
 * elsewhere (source 'formaloo') have no account and no files.
 */
export async function createTeacherApplication(input: {
	name: string; email: string; phone?: string; position?: string; church?: string; experience?: string; statement?: string; resumeUrl?: string; source?: string;
	familyId?: string; files?: Partial<Record<'cv' | 'cover' | 'other', File | null>>;
	/** Staff moving someone in (from a family inquiry): no receipt email to them. */
	quiet?: boolean; by?: string;
}): Promise<Result<{ id: string }, { fields?: Record<string, string> }>> {
	await dbReady();
	const name = clip(input.name, 120), email = clip(input.email, 254).toLowerCase();
	const fields: Record<string, string> = {};
	if (name.length < 2) fields.name = 'Enter your name.';
	if (!validEmail(email)) fields.email = 'Enter an email address like name@example.com.';
	const resumeUrl = clip(input.resumeUrl, 500);
	if (resumeUrl && !/^https?:\/\/\S+$/.test(resumeUrl)) fields.resumeUrl = 'Enter a full link, starting with https://';
	const uploads = Object.entries(input.files ?? {}).filter((entry): entry is [string, File] => Boolean(entry[1]?.size));
	if (input.familyId && !uploads.some(([kind]) => kind === 'cv')) fields.cv = 'Add your CV or résumé.';
	for (const [kind, file] of uploads) if (file.size > FILE_BYTES) fields[kind] = 'Files must be 15 MB or smaller.';
	if (Object.keys(fields).length) return { ok: false, error: 'Check the highlighted fields.', fields };
	if (input.familyId) {
		const [open] = await db()`select 1 from teacher_applicants where family_id = ${input.familyId} and status not in ('hired', 'declined', 'withdrawn')`;
		if (open) return { ok: false, error: 'You already have an application in progress.' };
	}
	const files: ApplicantFile[] = [];
	for (const [kind, file] of uploads) {
		const stored = await saveFlyerBytes(new Uint8Array(await file.arrayBuffer()), { name: file.name.slice(0, 200), contentType: file.type || 'application/octet-stream' }, 'doc');
		files.push({ kind, key: stored.key, name: stored.name });
	}
	const id = randomUUID();
	await db()`
		insert into teacher_applicants (id, name, email, phone, position, church, experience, statement, resume_url, source, family_id, files)
		values (${id}, ${name}, ${email}, ${clip(input.phone, 40)}, ${clip(input.position, 200)}, ${clip(input.church, 200)}, ${clip(input.experience, 4000)}, ${clip(input.statement, 6000)}, ${resumeUrl}, ${input.source === 'formaloo' ? 'formaloo' : 'portal'}, ${input.familyId ?? null}, ${db().json(files)})`;
	await log(id, input.by || 'applicant', 'stage', input.by ? `Moved from a family inquiry by ${input.by}` : 'Applied');
	if (input.quiet) return { ok: true, id };
	await sendTemplate('hiring.received', email, { name: name.split(' ')[0] });
	await notifyStaff(`Teacher application from ${name}`, `${name} (${email}) applied to teach${input.position ? `: ${clip(input.position, 200)}` : ''}.\n\nReview: ${portalOrigin()}/admin/hiring?app=${id}`);
	return { ok: true, id };
}

function mapApplicant(row: Record<string, any>): TeacherApplicant {
	return {
		id: String(row.id), createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)!, status: row.status as HiringStage,
		name: String(row.name), email: String(row.email), phone: String(row.phone || ''), position: String(row.position || ''), church: String(row.church || ''),
		experience: String(row.experience || ''), statement: String(row.statement || ''), resumeUrl: String(row.resume_url || ''), source: String(row.source || 'portal'),
		videoWith: String(row.video_with || ''), videoAt: iso(row.video_at), boardAt: iso(row.board_at),
		familyId: row.family_id ? String(row.family_id) : null, files: Array.isArray(row.files) ? row.files.map((file: any) => ({ kind: String(file.kind), key: String(file.key), name: String(file.name) })) : [],
		tally: { yes: Number(row.yes || 0), maybe: Number(row.maybe || 0), no: Number(row.no || 0) },
	};
}

/** Every candidate with the tally of each reviewer's latest recommendation. */
export async function listTeacherApplicants(): Promise<TeacherApplicant[]> {
	await dbReady();
	const rows = await db()`
		select a.*,
			count(*) filter (where r.recommendation = 'yes') as yes, count(*) filter (where r.recommendation = 'maybe') as maybe, count(*) filter (where r.recommendation = 'no') as no
		from teacher_applicants a
		left join lateral (
			select distinct on (n.by) n.recommendation from teacher_applicant_notes n
			where n.applicant_id = a.id and n.kind = 'recommendation' order by n.by, n.at desc
		) r on true
		group by a.id order by a.updated_at desc`;
	return rows.map(mapApplicant);
}

export async function applicantNotes(id: string): Promise<ApplicantNote[]> {
	await dbReady();
	const rows = await db()`select id, at, by, kind, recommendation, note from teacher_applicant_notes where applicant_id = ${id} order by at desc`;
	return rows.map((row) => ({ id: String(row.id), at: iso(row.at)!, by: String(row.by), kind: row.kind, recommendation: (row.recommendation ?? null) as Recommendation | null, note: String(row.note) }));
}

/** The full teacher application link candidates get at the Full application stage. */
const FULL_APPLICATION_KEY = 'teacher_full_application_url';
export async function teacherApplicationUrl(): Promise<string> {
	await dbReady();
	const [row] = await db()`select value from settings where key = ${FULL_APPLICATION_KEY}`;
	return typeof row?.value === 'string' ? row.value : '';
}
export async function setTeacherApplicationUrl(input: string): Promise<Result> {
	await dbReady();
	const url = input.trim();
	if (url && !/^https:\/\/\S+$/.test(url)) return { ok: false, error: 'Enter the full link, starting with https://' };
	if (!url) await db()`delete from settings where key = ${FULL_APPLICATION_KEY}`;
	else await db()`insert into settings (key, value) values (${FULL_APPLICATION_KEY}, ${db().json(url)}) on conflict (key) do update set value = excluded.value`;
	return { ok: true };
}

/**
 * Move a candidate. Stages that write to the candidate email them once:
 * Full application (the link), Video lesson (an invitation), Not moving forward
 * (a kind note). Hired gives them Teacher access (which emails them a sign-in).
 */
export async function setApplicantStage(id: string, stage: string, by: string): Promise<Result> {
	await dbReady();
	if (!HIRING_STAGES.some((item) => item.value === stage)) return { ok: false, error: 'Choose a stage.' };
	// Full application: the portal form when one is published and the candidate has an account; otherwise the link.
	const [current] = await db()`select family_id, status from teacher_applicants where id = ${id}`;
	if (!current) return { ok: false, error: 'That candidate no longer exists.' };
	const form = stage === 'full_application' && current.family_id ? await teacherForm() : null;
	const link = stage !== 'full_application' ? '' : form ? `${portalOrigin()}/teaching` : await teacherApplicationUrl();
	if (stage === 'full_application' && !link) return { ok: false, error: current.family_id ? 'Publish a Teacher full application form (Documents & forms → Forms), or set the application link (Hiring → Application link).' : 'This candidate has no portal account. Set the full application link first (Hiring → Application link).' };
	const [row] = await db()`
		update teacher_applicants set status = ${stage}, stage_by = ${by}, updated_at = now() where id = ${id}
		returning name, email, (select status from teacher_applicants where id = ${id}) as before`;
	if (!row) return { ok: false, error: 'That candidate no longer exists.' };
	if (row.before === stage) return { ok: true };
	await log(id, by, 'stage', hiringStageLabel(stage));
	const first = String(row.name).split(' ')[0], email = String(row.email);
	if (stage === 'full_application' && form) {
		const [exists] = await db()`select 1 from form_assignments where teacher_applicant_id = ${id} and form_id = ${form}`;
		if (!exists) await db()`insert into form_assignments (id, form_id, family_id, teacher_applicant_id) values (${randomUUID()}, ${form}, ${current.family_id}, ${id})`;
	}
	if (stage === 'full_application') { await sendTemplate('hiring.full-application', email, { name: first, link }); await log(id, by, 'email', 'Sent the full application'); }
	if (stage === 'video_lesson') { await sendTemplate('hiring.video-lesson', email, { name: first }); await log(id, by, 'email', 'Invited to a video lesson interview'); }
	if (stage === 'declined') { await sendTemplate('hiring.declined', email, { name: first }); await log(id, by, 'email', 'Sent the not-moving-forward note'); }
	if (stage === 'hired') {
		const granted = await grantAccess({ email, roles: ['staff'], by });
		await log(id, by, 'note', granted.ok ? 'Given Teacher access in the portal' : `Couldn’t give Teacher access: ${granted.error}`);
	}
	return { ok: true };
}

/** Who runs the video lesson and when; when the board interview is. Times are ISO, or '' to clear. */
export async function scheduleApplicant(input: { id: string; videoWith?: string; videoAt?: string; boardAt?: string }, by: string): Promise<Result> {
	await dbReady();
	const at = (value: string | undefined) => (value ? new Date(value).toISOString() : null);
	if ([input.videoAt, input.boardAt].some((value) => value && Number.isNaN(Date.parse(value)))) return { ok: false, error: 'Enter a date and time.' };
	const [row] = await db()`
		update teacher_applicants set video_with = ${clip(input.videoWith, 254).toLowerCase()}, video_at = ${at(input.videoAt)}, board_at = ${at(input.boardAt)}, updated_at = now()
		where id = ${input.id} returning id`;
	if (!row) return { ok: false, error: 'That candidate no longer exists.' };
	await log(input.id, by, 'note', 'Updated the interview schedule');
	return { ok: true };
}

/** A note, or a reviewer's recommendation (their latest one counts in the tally). */
export async function addApplicantNote(input: { id: string; note: string; recommendation?: string }, by: string): Promise<Result> {
	await dbReady();
	const note = clip(input.note, 4000);
	const recommendation = RECOMMENDATIONS.some((item) => item.value === input.recommendation) ? (input.recommendation as Recommendation) : null;
	if (!note && !recommendation) return { ok: false, error: 'Write a note or choose a recommendation.' };
	const [exists] = await db()`select 1 from teacher_applicants where id = ${input.id}`;
	if (!exists) return { ok: false, error: 'That candidate no longer exists.' };
	await log(input.id, by, recommendation ? 'recommendation' : 'note', note, recommendation);
	return { ok: true };
}

/** The published Teacher full application form, if any. */
async function teacherForm(): Promise<string | null> {
	const [row] = await db()`select id from school_forms where purpose = 'teacher' and status = 'open' order by created_at desc limit 1`;
	return row ? String(row.id) : null;
}

/** The candidate submitted the in-portal full application. */
export async function teacherFormSubmitted(applicantId: string): Promise<void> {
	const [row] = await db()`select name from teacher_applicants where id = ${applicantId}`;
	if (!row) return;
	await db()`update teacher_applicants set updated_at = now() where id = ${applicantId}`;
	await log(applicantId, 'applicant', 'note', 'Submitted the full application');
	await notifyStaff(`${row.name} submitted their full application`, `Review: ${portalOrigin()}/admin/hiring?app=${applicantId}`);
}

export type MyTeacherApplication = TeacherApplicant & {
	/** The in-portal full application, when one was sent. */
	form: { id: string; status: string } | null;
	/** The outside link, when the full application isn't a portal form. */
	formLink: string;
};

/**
 * The signed-in person's latest teaching application. One made before they had
 * an account (same email) is linked to it here.
 */
export async function myTeacherApplication(familyId: string, email: string): Promise<MyTeacherApplication | null> {
	await dbReady();
	const emails = await personEmails(email);
	await db()`update teacher_applicants set family_id = ${familyId} where family_id is null and lower(email) in ${db()(emails)}`;
	const [row] = await db()`select a.*, 0 as yes, 0 as maybe, 0 as no from teacher_applicants a where a.family_id = ${familyId} order by a.created_at desc limit 1`;
	if (!row) return null;
	const app = mapApplicant(row);
	const [form] = await db()`select id, status from form_assignments where teacher_applicant_id = ${app.id} order by submitted_at desc nulls first limit 1`;
	const formLink = !form && app.status !== 'applied' ? await teacherApplicationUrl() : '';
	return { ...app, form: form ? { id: String(form.id), status: String(form.status) } : null, formLink };
}

/** The candidate's full application answers, for reviewers. */
export async function applicantFullApplication(applicantId: string): Promise<{ assignmentId: string; status: string; submittedAt: string | null; answers: { id: string; label: string; type: string; value: string }[] } | null> {
	await dbReady();
	const [row] = await db()`
		select a.id, a.status, a.submitted_at, a.answers, f.questions from form_assignments a join school_forms f on f.id = a.form_id
		where a.teacher_applicant_id = ${applicantId} order by a.submitted_at desc nulls last limit 1`;
	if (!row) return null;
	const answers = (row.answers ?? {}) as Record<string, string>;
	const questions = (Array.isArray(row.questions) ? row.questions : []) as { id: string; label: string; type: string }[];
	return {
		assignmentId: String(row.id), status: String(row.status), submittedAt: iso(row.submitted_at),
		answers: questions.map((question) => ({ id: question.id, label: question.label, type: question.type, value: String(answers[question.id] ?? '') })),
	};
}

/** One of a candidate's uploads. Reviewers (checked by the caller) or the candidate's own household. */
export async function readApplicantFile(input: { applicantId: string; key: string; familyId?: string }): Promise<{ data: Uint8Array; contentType: string; name: string } | null> {
	await dbReady();
	const [row] = await db()`select family_id, files from teacher_applicants where id = ${input.applicantId}`;
	if (!row || (input.familyId && String(row.family_id) !== input.familyId)) return null;
	const files = Array.isArray(row.files) ? row.files : [];
	if (!files.some((file: any) => file.key === input.key) || !/^doc\//.test(input.key)) return null;
	return readFlyerBytes(input.key);
}

/** The candidate withdraws their own application. */
export async function withdrawMyApplication(applicantId: string, familyId: string, by: string): Promise<Result> {
	await dbReady();
	const [row] = await db()`
		update teacher_applicants set status = 'withdrawn', stage_by = ${by}, updated_at = now()
		where id = ${applicantId} and family_id = ${familyId} and status not in ('hired', 'declined', 'withdrawn') returning name`;
	if (!row) return { ok: false, error: 'That application is already closed.' };
	await log(applicantId, by, 'stage', 'Withdrew (by the candidate)');
	await notifyStaff(`${row.name} withdrew their teaching application`, `${portalOrigin()}/admin/hiring?app=${applicantId}&closed=1`);
	return { ok: true };
}
