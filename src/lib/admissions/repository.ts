import { randomUUID } from 'node:crypto';
import {
	type Banner,
	type BannerDocument,
	type BannerFlyer,
	emptyBannerDocument,
} from './banner.ts';
import { TOUR_DEFAULTS } from './defaults.ts';
import {
	chicagoToday,
	defaultTourDates,
	formatLongDate,
	formatTimeRange,
	schoolYearLabel,
	seasonYear,
	type TourDateRecord,
	isHhmm,
	isIsoDate,
} from './dates.ts';
import type { InterestInput, TourRequestInput } from './validation.ts';
import { getDocStore, type DocStore } from './store.ts';

const BANNER_KEY = 'banner';
const DATES_KEY = 'tour-dates';
const REQUESTS_KEY = 'tour-requests';
const INTEREST_KEY = 'interest';

export type TourRequestRecord = TourRequestInput & {
	id: string;
	createdAt: string;
	status: 'confirmed' | 'cancelled';
};

export type InterestRecord = InterestInput & {
	id: string;
	createdAt: string;
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

type DatesDocument = { dates: TourDateRecord[] };

function storeOf(store?: DocStore): DocStore {
	return store ?? getDocStore();
}

async function writeJson(store: DocStore, key: string, data: unknown, etag?: string): Promise<boolean> {
	return store.setJson(key, data, etag);
}

export async function readBannerDocument(store?: DocStore): Promise<BannerDocument> {
	const stored = await storeOf(store).getJson<BannerDocument>(BANNER_KEY);
	if (!stored?.data?.current) return emptyBannerDocument();
	return {
		current: { ...emptyBannerDocument().current, ...stored.data.current, modal: { ...emptyBannerDocument().current.modal, ...stored.data.current.modal } },
		history: Array.isArray(stored.data.history) ? stored.data.history : [],
	};
}

export async function saveBanner(next: Banner, store?: DocStore): Promise<BannerDocument> {
	const docStore = storeOf(store);
	for (let attempt = 0; attempt < 6; attempt += 1) {
		const stored = await docStore.getJson<BannerDocument>(BANNER_KEY);
		const current = stored?.data?.current;
		const history = stored?.data?.history ?? [];
		const previous = current?.text || current?.flyer ? [current, ...history].slice(0, 20) : history;
		const document: BannerDocument = {
			current: { ...next, updatedAt: new Date().toISOString() },
			history: previous.filter((item): item is Banner => Boolean(item)),
		};
		const wrote = await writeJson(docStore, BANNER_KEY, document, stored?.etag);
		if (wrote) return document;
		if (!stored) {
			const created = await writeJson(docStore, BANNER_KEY, document);
			if (created) return document;
		}
	}
	throw new Error('Could not save the banner.');
}

export async function saveFlyer(
	bytes: Uint8Array,
	flyer: Omit<BannerFlyer, 'key' | 'size'>,
	store?: DocStore,
): Promise<BannerFlyer> {
	const key = `flyer/${randomUUID()}`;
	const saved: BannerFlyer = { ...flyer, key, size: bytes.byteLength };
	await storeOf(store).setBytes(key, bytes, {
		contentType: saved.contentType,
		name: saved.name,
	});
	return saved;
}

export async function readFlyer(key: string, store?: DocStore) {
	if (!/^flyer\/[0-9a-f-]{36}$/i.test(key)) return null;
	return storeOf(store).getBytes(key);
}

function normalizeStoredDates(value: unknown): TourDateRecord[] | null {
	if (!value || typeof value !== 'object') return null;
	const dates = (value as DatesDocument).dates;
	if (!Array.isArray(dates)) return null;
	return dates.filter((date): date is TourDateRecord => {
		return Boolean(
			date &&
				typeof date === 'object' &&
				isIsoDate(date.date) &&
				isHhmm(date.startTime) &&
				isHhmm(date.endTime) &&
				Number.isInteger(date.capacity),
		);
	}).map((date) => ({
		id: date.date,
		date: date.date,
		capacity: Math.min(200, Math.max(0, date.capacity)),
		startTime: date.startTime,
		endTime: date.endTime,
		enabled: date.enabled !== false,
	}));
}

export async function readTourDates(store?: DocStore): Promise<{ dates: TourDateRecord[]; source: 'saved' | 'default' }> {
	const stored = await storeOf(store).getJson<DatesDocument>(DATES_KEY);
	const dates = normalizeStoredDates(stored?.data);
	if (!dates) return { dates: defaultTourDates(), source: 'default' };
	return { dates, source: 'saved' };
}

export async function saveTourDates(dates: TourDateRecord[], store?: DocStore): Promise<TourDateRecord[]> {
	const docStore = storeOf(store);
	const document = { dates };
	for (let attempt = 0; attempt < 6; attempt += 1) {
		const stored = await docStore.getJson<DatesDocument>(DATES_KEY);
		const wrote = await writeJson(docStore, DATES_KEY, document, stored?.etag);
		if (wrote || (!stored && (await writeJson(docStore, DATES_KEY, document)))) return dates;
	}
	throw new Error('Could not save tour dates.');
}

async function readRequests(store: DocStore): Promise<{ requests: TourRequestRecord[]; etag?: string }> {
	const stored = await store.getJson<TourRequestRecord[]>(REQUESTS_KEY);
	return { requests: Array.isArray(stored?.data) ? stored.data : [], etag: stored?.etag };
}

export async function listTourRequests(store?: DocStore): Promise<TourRequestRecord[]> {
	const { requests } = await readRequests(storeOf(store));
	return requests;
}

export function bookedCount(requests: TourRequestRecord[], dateId: string): number {
	return requests.filter((request) => request.tourDateId === dateId && request.status !== 'cancelled').length;
}

export function toPublicTourDate(date: TourDateRecord, requests: TourRequestRecord[], today: string): PublicTourDate | null {
	if (!date.enabled || date.date < today) return null;
	const booked = bookedCount(requests, date.id);
	const remaining = Math.max(0, date.capacity - booked);
	return {
		id: date.id,
		date: date.date,
		label: formatLongDate(date.date),
		timeLabel: formatTimeRange(date.startTime, date.endTime),
		capacity: date.capacity,
		booked,
		remaining,
		full: remaining <= 0,
	};
}

export async function publicTourSchedule(now = new Date(), store?: DocStore) {
	const docStore = storeOf(store);
	const today = chicagoToday(now);
	const [{ dates }, { requests }] = await Promise.all([readTourDates(docStore), readRequests(docStore)]);
	const publicDates = dates
		.map((date) => toPublicTourDate(date, requests, today))
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

export async function createTourRequest(input: TourRequestInput, store?: DocStore): Promise<CreateTourResult> {
	const docStore = storeOf(store);
	for (let attempt = 0; attempt < 6; attempt += 1) {
		const today = chicagoToday();
		const { dates } = await readTourDates(docStore);
		const date = dates.find((item) => item.id === input.tourDateId && item.enabled && item.date >= today);
		const { requests, etag } = await readRequests(docStore);
		if (!date) return { ok: false, code: 'date_unavailable' };
		if (bookedCount(requests, date.id) >= date.capacity) return { ok: false, code: 'date_full' };
		const request: TourRequestRecord = {
			...input,
			id: randomUUID(),
			createdAt: new Date().toISOString(),
			status: 'confirmed',
		};
		const wrote = await writeJson(docStore, REQUESTS_KEY, [...requests, request], etag);
		if (wrote) {
			const publicDate = toPublicTourDate(date, [...requests, request], today);
			return { ok: true, request, date: publicDate! };
		}
		if (!etag) {
			const created = await writeJson(docStore, REQUESTS_KEY, [request]);
			if (created) {
				const publicDate = toPublicTourDate(date, [request], today);
				return { ok: true, request, date: publicDate! };
			}
		}
	}
	return { ok: false, code: 'conflict' };
}

export async function cancelTourRequest(id: string, store?: DocStore): Promise<boolean> {
	const docStore = storeOf(store);
	for (let attempt = 0; attempt < 6; attempt += 1) {
		const { requests, etag } = await readRequests(docStore);
		const index = requests.findIndex((request) => request.id === id);
		if (index === -1) return false;
		const next = requests.slice();
		next[index] = { ...next[index], status: 'cancelled' };
		const wrote = await writeJson(docStore, REQUESTS_KEY, next, etag);
		if (wrote) return true;
	}
	throw new Error('Could not update that tour request.');
}

export async function listInterest(store?: DocStore): Promise<InterestRecord[]> {
	const stored = await storeOf(store).getJson<InterestRecord[]>(INTEREST_KEY);
	return Array.isArray(stored?.data) ? stored.data : [];
}

export async function createInterest(input: InterestInput, store?: DocStore): Promise<InterestRecord> {
	const docStore = storeOf(store);
	const record: InterestRecord = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
	for (let attempt = 0; attempt < 6; attempt += 1) {
		const stored = await docStore.getJson<InterestRecord[]>(INTEREST_KEY);
		const current = Array.isArray(stored?.data) ? stored.data : [];
		const wrote = await writeJson(docStore, INTEREST_KEY, [...current, record], stored?.etag);
		if (wrote) return record;
		if (!stored && (await writeJson(docStore, INTEREST_KEY, [record]))) return record;
	}
	throw new Error('Could not save the interest note.');
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
