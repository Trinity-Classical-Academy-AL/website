import {
	createInterest as insertInterest,
	createWebsiteTourRequest,
	getBannerDocument,
	importLegacyBundle,
	listTourDates,
	readLegacyJson,
	seatsFor,
	tourDatesConfigured,
	type InterestRow,
	type TourRequestRow,
} from '@tca/school';
import { readFlyerBytes } from '@tca/school';
import { type Banner, type BannerDocument, emptyBannerDocument } from './banner.ts';
import { TOUR_DEFAULTS } from './defaults.ts';
import {
	chicagoToday,
	defaultTourDates,
	formatLongDate,
	formatTimeRange,
	schoolYearLabel,
	seasonYear,
	type TourDateRecord,
} from './dates.ts';
import type { InterestInput, TourRequestInput } from './validation.ts';

export type TourRequestRecord = {
	id: string;
	createdAt: string;
	status: TourRequestRow['status'];
	tourDateId: string;
	parentName: string;
	email: string;
	phone: string;
	children: number;
	grades: string[];
	hearAbout: string;
	message: string;
};

export type InterestRecord = InterestInput & {
	id: string;
	createdAt: string;
	status: InterestRow['status'];
};

export type PublicTourDate = {
	id: string;
	date: string;
	label: string;
	timeLabel: string;
	capacity: number;
	booked: number;
	remaining: number;
	full: boolean;
};

let legacyOnce: Promise<void> | null = null;

export function ensureSchoolData(): Promise<void> {
	if (!legacyOnce) {
		legacyOnce = (async () => {
			const [banner, datesDoc, requests, interest] = await Promise.all([
				readLegacyJson<{ current?: Record<string, unknown>; history?: Record<string, unknown>[] }>('banner'),
				readLegacyJson<{ dates?: TourDateRecord[] }>('tour-dates'),
				readLegacyJson<Record<string, unknown>[]>('tour-requests'),
				readLegacyJson<Record<string, unknown>[]>('interest'),
			]);
			await importLegacyBundle({
				banner,
				dates: datesDoc?.dates ?? null,
				requests,
				interest,
			});
		})().catch((error) => {
			legacyOnce = null;
			throw error;
		});
	}
	return legacyOnce;
}

function mergeBanner(stored: { current: Record<string, unknown>; history: Record<string, unknown>[] } | null): BannerDocument {
	if (!stored?.current) return emptyBannerDocument();
	const empty = emptyBannerDocument();
	const current = stored.current as Partial<Banner>;
	return {
		current: {
			...empty.current,
			...current,
			modal: { ...empty.current.modal, ...(current.modal ?? {}) },
		},
		history: (stored.history ?? []) as Banner[],
	};
}

export async function readBannerDocument(): Promise<BannerDocument> {
	await ensureSchoolData();
	return mergeBanner(await getBannerDocument());
}

export async function readFlyer(key: string) {
	const file = await readFlyerBytes(key);
	if (!file) return null;
	return { data: file.data, metadata: { contentType: file.contentType, name: file.name } };
}

export function toPublicTourDate(date: TourDateRecord, booked: number, today: string): PublicTourDate | null {
	if (!date.enabled || date.date < today) return null;
	const remaining = Math.max(0, date.capacity - booked);
	return {
		id: date.date,
		date: date.date,
		label: formatLongDate(date.date),
		timeLabel: formatTimeRange(date.startTime, date.endTime),
		capacity: date.capacity,
		booked,
		remaining,
		full: remaining <= 0,
	};
}

async function scheduleDates(today: string): Promise<TourDateRecord[]> {
	if (!(await tourDatesConfigured())) return defaultTourDates(today);
	const rows = await listTourDates();
	return rows.map((date) => ({
		id: date.date,
		date: date.date,
		startTime: date.startTime,
		endTime: date.endTime,
		capacity: date.capacity,
		enabled: date.enabled,
	}));
}

export async function publicTourSchedule(now = new Date()) {
	await ensureSchoolData();
	const today = chicagoToday(now);
	const dates = await scheduleDates(today);
	const seats = await seatsFor(dates.map((date) => date.date));
	const publicDates = dates
		.map((date) => toPublicTourDate(date, seats.get(date.date) ?? 0, today))
		.filter((date): date is PublicTourDate => Boolean(date))
		.sort((a, b) => a.date.localeCompare(b.date));
	return {
		location: TOUR_DEFAULTS.location,
		schoolEmail: TOUR_DEFAULTS.schoolEmail,
		timeLabel: formatTimeRange(TOUR_DEFAULTS.startTime, TOUR_DEFAULTS.endTime),
		schoolYear: schoolYearLabel(seasonYear(today)),
		confirmationMessage: TOUR_DEFAULTS.confirmationMessage,
		whatToExpect: TOUR_DEFAULTS.whatToExpect,
		dates: publicDates,
		bookable: publicDates.filter((date) => !date.full).length,
	};
}

export type CreateTourResult =
	| { ok: true; request: TourRequestRecord; date: PublicTourDate }
	| { ok: false; code: 'date_unavailable' | 'date_full' | 'conflict' };

function toRecord(row: TourRequestRow): TourRequestRecord {
	return {
		id: row.id,
		createdAt: row.createdAt,
		status: row.status,
		tourDateId: row.tourDate,
		parentName: row.parentName,
		email: row.email,
		phone: row.phone,
		children: row.children,
		grades: row.grades,
		hearAbout: row.hearAbout,
		message: row.message,
	};
}

export async function createTourRequest(input: TourRequestInput): Promise<CreateTourResult> {
	await ensureSchoolData();
	const today = chicagoToday();
	const dates = await scheduleDates(today);
	const date = dates.find((item) => item.date === input.tourDateId && item.enabled && item.date >= today);
	if (!date) return { ok: false, code: 'date_unavailable' };
	const result = await createWebsiteTourRequest({
		tourDate: date.date,
		capacity: date.capacity,
		parentName: input.parentName,
		email: input.email,
		phone: input.phone,
		children: input.children,
		grades: input.grades,
		hearAbout: input.hearAbout,
		message: input.message,
	});
	if (!result.ok) return { ok: false, code: 'date_full' };
	const seats = await seatsFor([date.date]);
	const publicDate = toPublicTourDate(date, seats.get(date.date) ?? 0, today);
	return { ok: true, request: toRecord(result.request), date: publicDate! };
}

export async function createInterest(input: InterestInput): Promise<InterestRecord> {
	await ensureSchoolData();
	const row = await insertInterest(input);
	return {
		...input,
		id: row.id,
		createdAt: row.createdAt,
		status: row.status,
	};
}

export function describeTourRequest(request: TourRequestRecord, dateLabel: string, timeLabel: string): string {
	return [
		'New tour request — Trinity Classical Academy',
		'',
		`Name: ${request.parentName}`,
		`Email: ${request.email}`,
		`Phone: ${request.phone}`,
		`Children: ${request.children}`,
		`Grades: ${request.grades.join(', ')}`,
		`Tour: ${dateLabel} (${timeLabel})`,
		`Heard about us: ${request.hearAbout || '—'}`,
		`Message: ${request.message || '—'}`,
	].join('\n');
}

export function describeInterest(record: InterestRecord): string {
	return [
		'New interest note — Trinity Classical Academy',
		'',
		`Name: ${record.name}`,
		`Email: ${record.email}`,
		`Phone: ${record.phone || '—'}`,
		`Page: ${record.pagePath}`,
		`Message: ${record.message || '—'}`,
	].join('\n');
}
