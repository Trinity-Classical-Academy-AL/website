import type { Result } from './result.ts';
import { randomUUID } from 'node:crypto';
import { db, dbReady } from './db.ts';
import { notifyStaff, portalOrigin } from './email.ts';
import { csvResponse, toCsv } from './csv.ts';
import { sendInquiryAutoReply } from './inquiry-reply.ts';
import { inquiryDetailsText, type InterviewDetails } from './interview.ts';
import { cleanGrades, clip } from './contact-input.ts';
import { TOUR_STATUSES, type TourStatus } from './tours/model.ts';
import { contactType } from './incoming/model.ts';

export type InquiryRow = {
	id: string;
	createdAt: string;
	status: TourStatus;
	email: string;
	name: string;
	phone: string;
	grades: string;
	message: string;
	source: string;
	details: InterviewDetails | Record<string, never>;
};

/** What someone is interested in: the same choices as the website's contact form. */
export const INTERESTS = [
	{ value: 'enrolling', label: 'Enrolling my child' },
	{ value: 'learning', label: 'Learning more about the school' },
	{ value: 'visiting', label: 'Scheduling a visit' },
	{ value: 'teaching', label: 'Teaching at Trinity' },
	{ value: 'other', label: 'Something else' },
] as const;

export async function createInquiry(input: {
	email: string;
	name: string;
	phone: string;
	grades: string[];
	message: string;
	source: string;
	notify?: boolean;
	details?: InterviewDetails;
	/** What they're interested in (enrolling, learning, visiting, teaching, other): sets the inquiry's type. */
	interest?: string;
}): Promise<Result<{ id: string }>> {
	await dbReady();
	const email = input.email.trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Enter an email address like name@example.com.' };
	const name = clip(input.name, 160);
	const phone = clip(input.phone, 40);
	const message = clip(input.message, 2000);
	const source = clip(input.source, 80) || 'portal';
	const grades = cleanGrades(input.grades);
	const id = randomUUID();
	const interest = INTERESTS.some((item) => item.value === input.interest) ? input.interest! : '';
	const details = { ...(input.details || {}), ...(interest ? { interest } : {}) };
	await db()`
		insert into inquiries (id, email, name, phone, grades, message, source, details, contact_type)
		values (${id}, ${email}, ${name}, ${phone}, ${grades}, ${message}, ${source}, ${db().json(details)}, ${contactType(source, interest)})
	`;
	// Persist first. A failed staff notice or reply must never hide a saved inquiry.
	if (input.notify) {
		try {
			await notifyStaff(
				source === 'interview' ? `New interview request: ${name}` : 'New inquiry',
				[`Name: ${name || '—'}`, `Interested in: ${INTERESTS.find((item) => item.value === interest)?.label ?? '—'}`, `Email: ${email}`, `Phone: ${phone || '—'}`, `Grades: ${grades.join(', ') || '—'}`, `Source: ${source}`, `Message: ${message || '—'}`, inquiryDetailsText(input.details || {}), `${portalOrigin()}/admin/inquiries?inquiry=${id}`].filter(Boolean).join('\n'),
			);
		} catch { console.error('[inquiry] Staff notification failed; inquiry saved.', id); }
	}
	if (source === 'interview' || source === 'interested') {
		try { await sendInquiryAutoReply(id); }
		catch { console.error('[inquiry] Automatic reply failed; inquiry saved.', id); }
	}
	return { ok: true, id };
}

export async function listInquiries(): Promise<InquiryRow[]> {
	await dbReady();
	const rows = await db()`select id, created_at, status, email, name, phone, grades, message, source, details from inquiries order by created_at desc`;
	return rows.map((row) => ({
		id: String(row.id),
		createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ''),
		status: String(row.status) as TourStatus,
		email: String(row.email),
		name: String(row.name ?? ''),
		phone: String(row.phone ?? ''),
		grades: Array.isArray(row.grades) ? row.grades.map(String).join(', ') : '',
		message: String(row.message ?? ''),
		source: String(row.source ?? ''),
		details: row.details && typeof row.details === 'object' ? row.details : {},
	}));
}

export async function setInquiryStatus(id: string, status: TourStatus): Promise<void> {
	await dbReady();
	if (!Object.values(TOUR_STATUSES).includes(status)) return;
	await db()`update inquiries set status = ${status} where id = ${id}`;
}

export function inquiriesCsv(rows: InquiryRow[]): Response {
	const body = toCsv(rows.map((row) => ({ ...row, detailsText: inquiryDetailsText(row.details) })), [
		{ key: 'createdAt', label: 'Created' },
		{ key: 'status', label: 'Status' },
		{ key: 'name', label: 'Name' },
		{ key: 'email', label: 'Email' },
		{ key: 'phone', label: 'Phone' },
		{ key: 'grades', label: 'Grades' },
		{ key: 'message', label: 'Message' },
		{ key: 'source', label: 'Source' },
		{ key: 'detailsText', label: 'Details' },
	]);
	return csvResponse('inquiries.csv', body);
}
