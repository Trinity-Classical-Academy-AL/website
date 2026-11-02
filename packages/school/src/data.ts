import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { db, dbReady } from './db.ts';
import { likePattern } from './csv.ts';
import { hashPassword, verifyPassword } from './passwords.ts';
import { notifyStaff, portalOrigin, sendEmail } from './email.ts';

export type TourDateRow = {
	date: string;
	startTime: string;
	endTime: string;
	capacity: number;
	enabled: boolean;
};

export type TourRequestRow = {
	id: string;
	createdAt: string;
	status: 'new' | 'contacted' | 'cancelled';
	tourDate: string;
	parentName: string;
	email: string;
	phone: string;
	children: number;
	grades: string[];
	hearAbout: string;
	message: string;
};

export type InterestRow = {
	id: string;
	createdAt: string;
	status: 'new' | 'contacted';
	name: string;
	email: string;
	phone: string;
	pagePath: string;
	message: string;
};

export type FamilyRow = {
	id: string;
	name: string;
	email: string;
	phone: string;
	emailVerifiedAt: string | null;
	createdAt: string;
};

export type BookingRow = {
	id: string;
	familyId: string;
	familyName: string;
	email: string;
	tourDate: string;
	headCount: number;
	status: 'booked' | 'cancelled';
	createdAt: string;
};

export type QuestionRow = {
	id: string;
	familyId: string;
	familyName: string;
	email: string;
	body: string;
	status: 'new' | 'replied';
	createdAt: string;
};

export type EventRow = {
	id: string;
	title: string;
	description: string;
	startsAt: string;
	location: string;
	createdAt: string;
};

export type RsvpRow = {
	id: string;
	eventId: string;
	eventTitle: string;
	familyId: string;
	familyName: string;
	email: string;
	headCount: number;
	createdAt: string;
};

type BannerDocument = { current: Record<string, unknown>; history: Record<string, unknown>[] };

function iso(value: Date | string | null): string {
	if (!value) return '';
	if (value instanceof Date) return value.toISOString();
	return String(value);
}

function asStatus<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
	return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

async function logActivity(kind: string, summary: string) {
	await db()`insert into activity (kind, summary) values (${kind}, ${summary.slice(0, 500)})`;
}

export async function readSetting<T>(key: string): Promise<T | null> {
	await dbReady();
	const rows = await db()`select value from settings where key = ${key}`;
	return (rows[0]?.value as T | undefined) ?? null;
}

export async function writeSetting(key: string, value: unknown): Promise<void> {
	await dbReady();
	await db()`
		insert into settings (key, value) values (${key}, ${db().json(value as never)})
		on conflict (key) do update set value = excluded.value
	`;
}

export async function getBannerDocument(): Promise<BannerDocument | null> {
	const stored = await readSetting<BannerDocument>('banner');
	if (!stored?.current) return null;
	return { current: stored.current, history: Array.isArray(stored.history) ? stored.history : [] };
}

export async function saveBanner(next: Record<string, unknown>): Promise<BannerDocument> {
	const existing = await getBannerDocument();
	const current = existing?.current;
	const history = existing?.history ?? [];
	const keep = current && (current.text || current.flyer) ? [current, ...history].slice(0, 20) : history;
	const document: BannerDocument = {
		current: { ...next, updatedAt: new Date().toISOString() },
		history: keep,
	};
	await writeSetting('banner', document);
	await logActivity('banner', `Banner ${document.current.enabled ? 'saved (on)' : 'saved (off)'}: ${String(document.current.text || '').slice(0, 80)}`);
	return document;
}

export async function tourDatesConfigured(): Promise<boolean> {
	const flag = await readSetting<boolean>('tour_dates_configured');
	return flag === true;
}

export async function listTourDates(): Promise<TourDateRow[]> {
	await dbReady();
	const rows = await db()`
		select date::text as date, start_time, end_time, capacity, enabled
		from tour_dates
		order by date
	`;
	return rows.map((row) => ({
		date: String(row.date),
		startTime: String(row.start_time),
		endTime: String(row.end_time),
		capacity: Number(row.capacity),
		enabled: Boolean(row.enabled),
	}));
}

export async function saveTourDates(dates: TourDateRow[]): Promise<void> {
	await dbReady();
	await db().begin(async (tx) => {
		await tx`delete from tour_dates`;
		for (const date of dates) {
			await tx`
				insert into tour_dates (date, start_time, end_time, capacity, enabled)
				values (${date.date}, ${date.startTime}, ${date.endTime}, ${date.capacity}, ${date.enabled})
			`;
		}
		await tx`
			insert into settings (key, value) values ('tour_dates_configured', 'true'::jsonb)
			on conflict (key) do update set value = 'true'::jsonb
		`;
	});
	await logActivity('tour_dates', `Saved ${dates.length} tour date${dates.length === 1 ? '' : 's'}`);
}

export async function seatsFor(dates: string[]): Promise<Map<string, number>> {
	await dbReady();
	const map = new Map<string, number>();
	if (dates.length === 0) return map;
	const rows = await db()`
		select d::text as date,
			coalesce((select count(*) from tour_requests r where r.tour_date = d::date and r.status <> 'cancelled'), 0)
			+ coalesce((select sum(head_count) from tour_bookings b where b.tour_date = d::date and b.status = 'booked'), 0) as booked
		from unnest(${dates}::text[]) as d
	`;
	for (const row of rows) map.set(String(row.date), Number(row.booked));
	return map;
}

async function withDateLock<T>(date: string, task: (tx: ReturnType<typeof db>, seats: number) => Promise<T>): Promise<T> {
	await dbReady();
	return db().begin(async (tx) => {
		await tx`select pg_advisory_xact_lock(hashtext(${date}))`;
		const rows = await tx`
			select
				coalesce((select count(*) from tour_requests r where r.tour_date = ${date}::date and r.status <> 'cancelled'), 0)
				+ coalesce((select sum(head_count) from tour_bookings b where b.tour_date = ${date}::date and b.status = 'booked'), 0) as booked
		`;
		return task(tx, Number(rows[0]?.booked ?? 0));
	});
}

export async function createWebsiteTourRequest(input: {
	tourDate: string;
	capacity: number;
	parentName: string;
	email: string;
	phone: string;
	children: number;
	grades: string[];
	hearAbout: string;
	message: string;
}): Promise<{ ok: true; request: TourRequestRow } | { ok: false; code: 'date_full' }> {
	const id = randomUUID();
	const created = await withDateLock(input.tourDate, async (tx, seats) => {
		if (seats >= input.capacity) return null;
		await tx`
			insert into tour_requests (id, status, tour_date, parent_name, email, phone, children, grades, hear_about, message)
			values (${id}, 'new', ${input.tourDate}, ${input.parentName}, ${input.email}, ${input.phone}, ${input.children}, ${input.grades}, ${input.hearAbout}, ${input.message})
		`;
		return true;
	});
	if (!created) return { ok: false, code: 'date_full' };
	const request = (await listTourRequests('')).find((row) => row.id === id)!;
	await logActivity('tour_request', `${input.parentName} requested a tour on ${input.tourDate}`);
	await notifyStaff(
		'New tour request',
		[`Name: ${input.parentName}`, `Email: ${input.email}`, `Phone: ${input.phone}`, `Tour: ${input.tourDate}`, `Grades: ${input.grades.join(', ') || '—'}`, `Message: ${input.message || '—'}`].join('\n'),
	);
	return { ok: true, request };
}

function mapRequest(row: Record<string, unknown>): TourRequestRow {
	return {
		id: String(row.id),
		createdAt: iso(row.created_at as Date),
		status: asStatus(String(row.status), ['new', 'contacted', 'cancelled'] as const, 'new'),
		tourDate: String(row.tour_date),
		parentName: String(row.parent_name),
		email: String(row.email),
		phone: String(row.phone),
		children: Number(row.children),
		grades: Array.isArray(row.grades) ? row.grades.map(String) : [],
		hearAbout: String(row.hear_about ?? ''),
		message: String(row.message ?? ''),
	};
}

export async function listTourRequests(query: string): Promise<TourRequestRow[]> {
	await dbReady();
	const rows = query
		? await db()`
			select id, created_at, status, tour_date::text as tour_date, parent_name, email, phone, children, grades, hear_about, message
			from tour_requests
			where parent_name ilike ${likePattern(query)} escape '\\'
				or email ilike ${likePattern(query)} escape '\\'
				or phone ilike ${likePattern(query)} escape '\\'
				or message ilike ${likePattern(query)} escape '\\'
				or tour_date::text ilike ${likePattern(query)} escape '\\'
			order by created_at desc
		`
		: await db()`
			select id, created_at, status, tour_date::text as tour_date, parent_name, email, phone, children, grades, hear_about, message
			from tour_requests
			order by created_at desc
		`;
	return rows.map((row) => mapRequest(row));
}

export async function setTourRequestStatus(id: string, status: 'new' | 'contacted' | 'cancelled'): Promise<boolean> {
	await dbReady();
	const rows = await db()`update tour_requests set status = ${status} where id = ${id} returning parent_name, tour_date::text as tour_date`;
	if (!rows[0]) return false;
	await logActivity('tour_request', `${rows[0].parent_name}'s tour on ${rows[0].tour_date} marked ${status}`);
	return true;
}

export async function listInterest(query: string): Promise<InterestRow[]> {
	await dbReady();
	const rows = query
		? await db()`
			select id, created_at, status, name, email, phone, page_path, message
			from interest_notes
			where name ilike ${likePattern(query)} escape '\\'
				or email ilike ${likePattern(query)} escape '\\'
				or phone ilike ${likePattern(query)} escape '\\'
				or message ilike ${likePattern(query)} escape '\\'
			order by created_at desc
		`
		: await db()`select id, created_at, status, name, email, phone, page_path, message from interest_notes order by created_at desc`;
	return rows.map((row) => ({
		id: String(row.id),
		createdAt: iso(row.created_at),
		status: asStatus(String(row.status), ['new', 'contacted'] as const, 'new'),
		name: String(row.name),
		email: String(row.email),
		phone: String(row.phone ?? ''),
		pagePath: String(row.page_path ?? ''),
		message: String(row.message ?? ''),
	}));
}

export async function createInterest(input: { name: string; email: string; phone: string; pagePath: string; message: string }): Promise<InterestRow> {
	await dbReady();
	const id = randomUUID();
	await db()`
		insert into interest_notes (id, name, email, phone, page_path, message)
		values (${id}, ${input.name}, ${input.email}, ${input.phone}, ${input.pagePath}, ${input.message})
	`;
	await logActivity('interest', `${input.name} left an interest note`);
	await notifyStaff('New interest note', [`Name: ${input.name}`, `Email: ${input.email}`, `Phone: ${input.phone || '—'}`, `Page: ${input.pagePath}`, `Message: ${input.message || '—'}`].join('\n'));
	const rows = await listInterest('');
	return rows.find((row) => row.id === id)!;
}

export async function setInterestStatus(id: string, status: 'new' | 'contacted'): Promise<boolean> {
	await dbReady();
	const rows = await db()`update interest_notes set status = ${status} where id = ${id} returning name`;
	if (!rows[0]) return false;
	await logActivity('interest', `${rows[0].name}'s interest note marked ${status}`);
	return true;
}

function tokenHash(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

async function issueToken(familyId: string, purpose: 'verify' | 'reset', hours: number): Promise<string> {
	const token = randomBytes(32).toString('base64url');
	const id = randomUUID();
	await db()`
		insert into email_tokens (id, family_id, purpose, token_hash, expires_at)
		values (${id}, ${familyId}, ${purpose}, ${tokenHash(token)}, now() + make_interval(hours => ${hours}))
	`;
	return token;
}

export async function signUpFamily(input: { name: string; email: string; phone: string; password: string }): Promise<
	| { ok: true; familyId: string; verifyUrl: string; email: Awaited<ReturnType<typeof sendEmail>> }
	| { ok: false; code: 'email_taken' }
> {
	await dbReady();
	const email = input.email.trim().toLowerCase();
	const existing = await db()`select id from families where email = ${email}`;
	if (existing[0]) return { ok: false, code: 'email_taken' };
	const id = randomUUID();
	const passwordHash = await hashPassword(input.password);
	await db()`
		insert into families (id, name, email, phone, password_hash)
		values (${id}, ${input.name.trim()}, ${email}, ${input.phone}, ${passwordHash})
	`;
	const token = await issueToken(id, 'verify', 48);
	const verifyUrl = `${portalOrigin()}/verify?token=${encodeURIComponent(token)}`;
	const emailResult = await sendEmail({
		to: email,
		subject: 'Confirm your Trinity family account',
		text: `Hello ${input.name.trim()},\n\nConfirm your family account so you can book a tour and RSVP:\n${verifyUrl}\n\nThis link expires in two days.`,
	});
	await logActivity('family', `${input.name.trim()} created a family account`);
	return { ok: true, familyId: id, verifyUrl, email: emailResult };
}

export async function verifyEmailToken(token: string): Promise<string | null> {
	await dbReady();
	const rows = await db()`
		update email_tokens
		set used_at = now()
		where token_hash = ${tokenHash(token)}
			and purpose = 'verify'
			and used_at is null
			and expires_at > now()
		returning family_id
	`;
	const familyId = rows[0]?.family_id ? String(rows[0].family_id) : '';
	if (!familyId) return null;
	await db()`update families set email_verified_at = coalesce(email_verified_at, now()) where id = ${familyId}`;
	return familyId;
}

export async function signInFamily(email: string, password: string): Promise<
	| { ok: true; familyId: string }
	| { ok: false; code: 'invalid' | 'unverified'; verifyUrl?: string; email?: Awaited<ReturnType<typeof sendEmail>> }
> {
	await dbReady();
	const rows = await db()`select id, password_hash, email_verified_at, name, email from families where email = ${email.trim().toLowerCase()}`;
	const family = rows[0];
	if (!family || !(await verifyPassword(password, String(family.password_hash)))) return { ok: false, code: 'invalid' };
	if (!family.email_verified_at) {
		const token = await issueToken(String(family.id), 'verify', 48);
		const verifyUrl = `${portalOrigin()}/verify?token=${encodeURIComponent(token)}`;
		const emailResult = await sendEmail({
			to: String(family.email),
			subject: 'Confirm your Trinity family account',
			text: `Hello ${family.name},\n\nConfirm your family account:\n${verifyUrl}\n\nThis link expires in two days.`,
		});
		return { ok: false, code: 'unverified', verifyUrl, email: emailResult };
	}
	return { ok: true, familyId: String(family.id) };
}

export async function requestPasswordReset(email: string): Promise<{ verifyUrl: string | null; email: Awaited<ReturnType<typeof sendEmail>> | null }> {
	await dbReady();
	const rows = await db()`select id, name, email from families where email = ${email.trim().toLowerCase()}`;
	if (!rows[0]) return { verifyUrl: null, email: null };
	const token = await issueToken(String(rows[0].id), 'reset', 1);
	const resetUrl = `${portalOrigin()}/reset?token=${encodeURIComponent(token)}`;
	const emailResult = await sendEmail({
		to: String(rows[0].email),
		subject: 'Reset your Trinity family password',
		text: `Hello ${rows[0].name},\n\nSet a new password:\n${resetUrl}\n\nThis link expires in one hour. If you did not ask for this, you can ignore it.`,
	});
	return { verifyUrl: resetUrl, email: emailResult };
}

export async function resetPassword(token: string, password: string): Promise<boolean> {
	await dbReady();
	const rows = await db()`
		update email_tokens
		set used_at = now()
		where token_hash = ${tokenHash(token)}
			and purpose = 'reset'
			and used_at is null
			and expires_at > now()
		returning family_id
	`;
	if (!rows[0]) return false;
	const passwordHash = await hashPassword(password);
	await db()`update families set password_hash = ${passwordHash} where id = ${rows[0].family_id}`;
	return true;
}

export async function getFamily(id: string): Promise<FamilyRow | null> {
	await dbReady();
	const rows = await db()`select id, name, email, phone, email_verified_at, created_at from families where id = ${id}`;
	if (!rows[0]) return null;
	return {
		id: String(rows[0].id),
		name: String(rows[0].name),
		email: String(rows[0].email),
		phone: String(rows[0].phone ?? ''),
		emailVerifiedAt: rows[0].email_verified_at ? iso(rows[0].email_verified_at) : null,
		createdAt: iso(rows[0].created_at),
	};
}

export async function updateFamilyProfile(id: string, input: { name: string; phone: string; password?: string; currentPassword?: string }): Promise<{ ok: true } | { ok: false; error: string }> {
	const family = await db()`select password_hash from families where id = ${id}`;
	if (!family[0]) return { ok: false, error: 'That account is not on file.' };
	if (input.password) {
		if (!input.currentPassword || !(await verifyPassword(input.currentPassword, String(family[0].password_hash)))) {
			return { ok: false, error: 'The current password does not match.' };
		}
		const passwordHash = await hashPassword(input.password);
		await db()`update families set name = ${input.name.trim()}, phone = ${input.phone}, password_hash = ${passwordHash} where id = ${id}`;
	} else {
		await db()`update families set name = ${input.name.trim()}, phone = ${input.phone} where id = ${id}`;
	}
	return { ok: true };
}

export async function listFamilies(query: string): Promise<FamilyRow[]> {
	await dbReady();
	const rows = query
		? await db()`
			select id, name, email, phone, email_verified_at, created_at from families
			where name ilike ${likePattern(query)} escape '\\'
				or email ilike ${likePattern(query)} escape '\\'
				or phone ilike ${likePattern(query)} escape '\\'
			order by created_at desc
		`
		: await db()`select id, name, email, phone, email_verified_at, created_at from families order by created_at desc`;
	return rows.map((row) => ({
		id: String(row.id),
		name: String(row.name),
		email: String(row.email),
		phone: String(row.phone ?? ''),
		emailVerifiedAt: row.email_verified_at ? iso(row.email_verified_at) : null,
		createdAt: iso(row.created_at),
	}));
}

export async function activeBooking(familyId: string): Promise<BookingRow | null> {
	const rows = await listBookings('');
	return rows.find((row) => row.familyId === familyId && row.status === 'booked') ?? null;
}

export async function bookTour(input: { familyId: string; familyName: string; email: string; tourDate: string; capacity: number; headCount: number }): Promise<
	{ ok: true } | { ok: false; code: 'already_booked' | 'date_full' | 'bad_count' }
> {
	if (!Number.isInteger(input.headCount) || input.headCount < 1 || input.headCount > 12) return { ok: false, code: 'bad_count' };
	const existing = await db()`select id from tour_bookings where family_id = ${input.familyId} and status = 'booked'`;
	if (existing[0]) return { ok: false, code: 'already_booked' };
	const id = randomUUID();
	const booked = await withDateLock(input.tourDate, async (tx, seats) => {
		if (seats + input.headCount > input.capacity) return false;
		await tx`
			insert into tour_bookings (id, family_id, tour_date, head_count, status)
			values (${id}, ${input.familyId}, ${input.tourDate}, ${input.headCount}, 'booked')
		`;
		return true;
	});
	if (!booked) return { ok: false, code: 'date_full' };
	await logActivity('booking', `${input.familyName} booked ${input.headCount} for ${input.tourDate}`);
	await sendEmail({
		to: input.email,
		subject: 'Your Trinity tour is booked',
		text: `Hello ${input.familyName},\n\nYou are booked for the campus tour on ${input.tourDate}, 9:00–10:00 AM, for ${input.headCount}.\n7160 Cahaba Valley Rd., Birmingham, AL 35242\n\nTo change plans, cancel the booking in the family portal and choose another date.`,
	});
	await notifyStaff('New tour booking', `${input.familyName} (${input.email}) booked ${input.headCount} for ${input.tourDate}.`);
	return { ok: true };
}

export async function cancelBooking(id: string, familyId?: string): Promise<boolean> {
	await dbReady();
	const rows = familyId
		? await db()`
			update tour_bookings set status = 'cancelled'
			where id = ${id} and family_id = ${familyId} and status = 'booked'
			returning family_id, tour_date::text as tour_date
		`
		: await db()`
			update tour_bookings set status = 'cancelled'
			where id = ${id} and status = 'booked'
			returning family_id, tour_date::text as tour_date
		`;
	if (!rows[0]) return false;
	await logActivity('booking', `Tour booking on ${rows[0].tour_date} was cancelled`);
	return true;
}

export async function listBookings(query: string): Promise<BookingRow[]> {
	await dbReady();
	const rows = query
		? await db()`
			select b.id, b.family_id, f.name as family_name, f.email, b.tour_date::text as tour_date, b.head_count, b.status, b.created_at
			from tour_bookings b join families f on f.id = b.family_id
			where f.name ilike ${likePattern(query)} escape '\\'
				or f.email ilike ${likePattern(query)} escape '\\'
				or b.tour_date::text ilike ${likePattern(query)} escape '\\'
			order by b.created_at desc
		`
		: await db()`
			select b.id, b.family_id, f.name as family_name, f.email, b.tour_date::text as tour_date, b.head_count, b.status, b.created_at
			from tour_bookings b join families f on f.id = b.family_id
			order by b.created_at desc
		`;
	return rows.map((row) => ({
		id: String(row.id),
		familyId: String(row.family_id),
		familyName: String(row.family_name),
		email: String(row.email),
		tourDate: String(row.tour_date),
		headCount: Number(row.head_count),
		status: asStatus(String(row.status), ['booked', 'cancelled'] as const, 'booked'),
		createdAt: iso(row.created_at),
	}));
}

export async function askQuestion(familyId: string, familyName: string, email: string, body: string): Promise<void> {
	await dbReady();
	await db()`insert into questions (id, family_id, body) values (${randomUUID()}, ${familyId}, ${body})`;
	await logActivity('question', `${familyName} asked a question`);
	await notifyStaff('New family question', `${familyName} (${email}) asked:\n\n${body}`);
}

export async function listQuestions(query: string, familyId?: string): Promise<QuestionRow[]> {
	await dbReady();
	const rows = await db()`
		select q.id, q.family_id, f.name as family_name, f.email, q.body, q.status, q.created_at
		from questions q join families f on f.id = q.family_id
		where (${familyId ?? null}::uuid is null or q.family_id = ${familyId ?? null})
			and (
				${query} = ''
				or f.name ilike ${likePattern(query || ' ')} escape '\\'
				or f.email ilike ${likePattern(query || ' ')} escape '\\'
				or q.body ilike ${likePattern(query || ' ')} escape '\\'
			)
		order by q.created_at desc
	`;
	return rows.map((row) => ({
		id: String(row.id),
		familyId: String(row.family_id),
		familyName: String(row.family_name),
		email: String(row.email),
		body: String(row.body),
		status: asStatus(String(row.status), ['new', 'replied'] as const, 'new'),
		createdAt: iso(row.created_at),
	}));
}

export async function markQuestionReplied(id: string): Promise<boolean> {
	await dbReady();
	const rows = await db()`update questions set status = 'replied' where id = ${id} returning id`;
	if (!rows[0]) return false;
	await logActivity('question', 'A question was marked replied');
	return true;
}

export async function listEvents(): Promise<EventRow[]> {
	await dbReady();
	const rows = await db()`select id, title, description, starts_at, location, created_at from events order by starts_at`;
	return rows.map((row) => ({
		id: String(row.id),
		title: String(row.title),
		description: String(row.description ?? ''),
		startsAt: iso(row.starts_at),
		location: String(row.location ?? ''),
		createdAt: iso(row.created_at),
	}));
}

export async function upcomingEvents(now = new Date()): Promise<EventRow[]> {
	const events = await listEvents();
	return events.filter((event) => new Date(event.startsAt).getTime() >= now.getTime() - 60 * 60 * 1000);
}

export async function saveEvent(input: { id?: string; title: string; description: string; startsAt: string; location: string }): Promise<string> {
	await dbReady();
	const id = input.id || randomUUID();
	if (input.id) {
		await db()`
			update events set title = ${input.title}, description = ${input.description}, starts_at = ${input.startsAt}, location = ${input.location}
			where id = ${id}
		`;
		await logActivity('event', `Updated event “${input.title}”`);
	} else {
		await db()`
			insert into events (id, title, description, starts_at, location)
			values (${id}, ${input.title}, ${input.description}, ${input.startsAt}, ${input.location})
		`;
		await logActivity('event', `Created event “${input.title}”`);
	}
	return id;
}

export async function deleteEvent(id: string): Promise<void> {
	await dbReady();
	const rows = await db()`delete from events where id = ${id} returning title`;
	if (rows[0]) await logActivity('event', `Deleted event “${rows[0].title}”`);
}

export async function listRsvps(query: string): Promise<RsvpRow[]> {
	await dbReady();
	const rows = query
		? await db()`
			select r.id, r.event_id, e.title as event_title, r.family_id, f.name as family_name, f.email, r.head_count, r.created_at
			from rsvps r
			join events e on e.id = r.event_id
			join families f on f.id = r.family_id
			where f.name ilike ${likePattern(query)} escape '\\'
				or f.email ilike ${likePattern(query)} escape '\\'
				or e.title ilike ${likePattern(query)} escape '\\'
			order by r.created_at desc
		`
		: await db()`
			select r.id, r.event_id, e.title as event_title, r.family_id, f.name as family_name, f.email, r.head_count, r.created_at
			from rsvps r
			join events e on e.id = r.event_id
			join families f on f.id = r.family_id
			order by r.created_at desc
		`;
	return rows.map((row) => ({
		id: String(row.id),
		eventId: String(row.event_id),
		eventTitle: String(row.event_title),
		familyId: String(row.family_id),
		familyName: String(row.family_name),
		email: String(row.email),
		headCount: Number(row.head_count),
		createdAt: iso(row.created_at),
	}));
}

export async function setRsvp(input: { eventId: string; familyId: string; familyName: string; email: string; eventTitle: string; headCount: number }): Promise<{ ok: true } | { ok: false; error: string }> {
	if (!Number.isInteger(input.headCount) || input.headCount < 1 || input.headCount > 12) {
		return { ok: false, error: 'Enter a head count from 1 to 12.' };
	}
	await dbReady();
	const id = randomUUID();
	await db()`
		insert into rsvps (id, event_id, family_id, head_count)
		values (${id}, ${input.eventId}, ${input.familyId}, ${input.headCount})
		on conflict (event_id, family_id) do update set head_count = excluded.head_count, created_at = now()
	`;
	await logActivity('rsvp', `${input.familyName} RSVPed ${input.headCount} for ${input.eventTitle}`);
	await sendEmail({
		to: input.email,
		subject: `RSVP confirmed: ${input.eventTitle}`,
		text: `Hello ${input.familyName},\n\nYou are down for ${input.headCount} at ${input.eventTitle}.\n\nYou can change the head count in the family portal.`,
	});
	await notifyStaff('New RSVP', `${input.familyName} (${input.email}) RSVPed ${input.headCount} for ${input.eventTitle}.`);
	return { ok: true };
}

export async function cancelRsvp(eventId: string, familyId: string): Promise<void> {
	await dbReady();
	await db()`delete from rsvps where event_id = ${eventId} and family_id = ${familyId}`;
}

export async function dashboardCounts(): Promise<{
	newRequests: number;
	newInterest: number;
	families: number;
	openQuestions: number;
	bookings: number;
	rsvps: number;
}> {
	await dbReady();
	const rows = await db()`
		select
			(select count(*) from tour_requests where status = 'new') as new_requests,
			(select count(*) from interest_notes where status = 'new') as new_interest,
			(select count(*) from families) as families,
			(select count(*) from questions where status = 'new') as open_questions,
			(select count(*) from tour_bookings where status = 'booked') as bookings,
			(select count(*) from rsvps) as rsvps
	`;
	const row = rows[0];
	return {
		newRequests: Number(row?.new_requests ?? 0),
		newInterest: Number(row?.new_interest ?? 0),
		families: Number(row?.families ?? 0),
		openQuestions: Number(row?.open_questions ?? 0),
		bookings: Number(row?.bookings ?? 0),
		rsvps: Number(row?.rsvps ?? 0),
	};
}

export async function recentActivity(limit = 12): Promise<{ createdAt: string; kind: string; summary: string }[]> {
	await dbReady();
	const rows = await db()`select created_at, kind, summary from activity order by id desc limit ${limit}`;
	return rows.map((row) => ({ createdAt: iso(row.created_at), kind: String(row.kind), summary: String(row.summary) }));
}

export type LegacyBundle = {
	banner?: { current?: Record<string, unknown>; history?: Record<string, unknown>[] } | null;
	dates?: { date: string; startTime: string; endTime: string; capacity: number; enabled: boolean }[] | null;
	requests?: Record<string, unknown>[] | null;
	interest?: Record<string, unknown>[] | null;
};

/** One-time copy from the old Netlify Blobs (or local file) store into Postgres. */
export async function importLegacyBundle(bundle: LegacyBundle): Promise<'imported' | 'skipped'> {
	await dbReady();
	return db().begin(async (tx) => {
		await tx`select pg_advisory_xact_lock(440214)`;
		const flag = await tx`select value from settings where key = 'legacy_import'`;
		if (flag[0]) return 'skipped' as const;
		if (bundle.banner?.current) {
			await tx`
				insert into settings (key, value) values ('banner', ${tx.json(bundle.banner as never)})
				on conflict (key) do nothing
			`;
		}
		if (bundle.dates && bundle.dates.length) {
			for (const date of bundle.dates) {
				await tx`
					insert into tour_dates (date, start_time, end_time, capacity, enabled)
					values (${date.date}, ${date.startTime}, ${date.endTime}, ${date.capacity}, ${date.enabled !== false})
					on conflict (date) do nothing
				`;
			}
			await tx`
				insert into settings (key, value) values ('tour_dates_configured', 'true'::jsonb)
				on conflict (key) do nothing
			`;
		}
		for (const request of bundle.requests ?? []) {
			const status = request.status === 'cancelled' ? 'cancelled' : 'new';
			const id = String(request.id || randomUUID());
			await tx`
				insert into tour_requests (id, created_at, status, tour_date, parent_name, email, phone, children, grades, hear_about, message)
				values (
					${id},
					${String(request.createdAt || new Date().toISOString())},
					${status},
					${String(request.tourDateId || request.tourDate || '')},
					${String(request.parentName || '')},
					${String(request.email || '')},
					${String(request.phone || '')},
					${Number(request.children) || 0},
					${Array.isArray(request.grades) ? request.grades.map(String) : []},
					${String(request.hearAbout || '')},
					${String(request.message || '')}
				)
				on conflict (id) do nothing
			`;
		}
		for (const note of bundle.interest ?? []) {
			await tx`
				insert into interest_notes (id, created_at, status, name, email, phone, page_path, message)
				values (
					${String(note.id || randomUUID())},
					${String(note.createdAt || new Date().toISOString())},
					'new',
					${String(note.name || '')},
					${String(note.email || '')},
					${String(note.phone || '')},
					${String(note.pagePath || '')},
					${String(note.message || '')}
				)
				on conflict (id) do nothing
			`;
		}
		await tx`insert into settings (key, value) values ('legacy_import', '{"done":true}'::jsonb) on conflict (key) do nothing`;
		return 'imported' as const;
	});
}
