import {
	ADMIN_COOKIE,
	getAdminToken,
	isAllowedAdminOrigin,
	readCookie,
	sessionCookieHeader,
	signSession,
	tokensMatch,
	verifySession,
} from './auth.ts';
import {
	bannerVersion,
	isBannerActive,
	sniffFlyer,
	toPublicBanner,
	type Banner,
	type BannerFlyer,
	type FlyerContentType,
} from './banner.ts';
import { toCsv } from './csv.ts';
import {
	chicagoToday,
	defaultTourDates,
	formatLongDate,
	formatTimeRange,
	isHhmm,
	isIsoDate,
	type TourDateRecord,
} from './dates.ts';
import { HttpError, json, noStoreFile, readJsonObject, routeOf, SESSION_MAX_AGE } from './http-utils.ts';
import { notifySchool } from './notify.ts';
import {
	bookedCount,
	cancelTourRequest,
	createInterest,
	createTourRequest,
	describeInterest,
	describeTourRequest,
	listInterest,
	listTourRequests,
	publicTourSchedule,
	readBannerDocument,
	readFlyer,
	readTourDates,
	saveBanner,
	saveFlyer,
	saveTourDates,
} from './repository.ts';
import {
	asString,
	errorSummary,
	givenName,
	isHoneypotTripped,
	validateBanner,
	validateInterest,
	validateTourRequest,
	type FieldErrors,
} from './validation.ts';
import { GRADE_OPTIONS, HEAR_ABOUT_OPTIONS, TOUR_DEFAULTS } from './defaults.ts';
function presentedSession(req: Request): string {
	const header = req.headers.get('authorization') ?? '';
	if (/^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, '').trim();
	return readCookie(req.headers.get('cookie'), ADMIN_COOKIE);
}

function adminDenied(req: Request): Response | null {
	const expected = getAdminToken();
	if (!expected) {
		return json(
			{
				error:
					'Admin access is not configured. Set the TCA_ADMIN_TOKEN environment variable on the website Netlify site, then redeploy.',
			},
			503,
		);
	}
	if (!verifySession(expected, presentedSession(req))) return json({ error: 'Sign in required.' }, 401);
	return null;
}

function withCors(req: Request, response: Response): Response {
	const origin = req.headers.get('origin');
	if (!origin || !isAllowedAdminOrigin(origin)) return response;
	const headers = new Headers(response.headers);
	headers.set('access-control-allow-origin', origin);
	headers.set('access-control-allow-credentials', 'true');
	headers.append('vary', 'Origin');
	return new Response(response.body, { status: response.status, headers });
}

function preflight(): Response {
	return new Response(null, {
		status: 204,
		headers: {
			'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
			'access-control-allow-headers': 'Content-Type, Authorization',
			'access-control-max-age': '86400',
		},
	});
}

function withRobots(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.set('x-robots-tag', 'noindex, nofollow');
	return new Response(response.body, { status: response.status, headers });
}

async function login(req: Request): Promise<Response> {
	const expected = getAdminToken();
	if (!expected) {
		return json(
			{
				error:
					'Admin access is not configured. Set the TCA_ADMIN_TOKEN environment variable on the website Netlify site, then redeploy.',
			},
			503,
		);
	}
	const body = await readJsonObject(req);
	if (!tokensMatch(asString(body.token), expected)) {
		return json(
			{ error: "That token isn't valid. Check for a typo, or ask for a new admin link." },
			401,
		);
	}
	const session = signSession(expected);
	return json({ ok: true }, 200, {
		'set-cookie': sessionCookieHeader(session, req, SESSION_MAX_AGE),
	});
}

function logout(req: Request): Response {
	return json({ ok: true }, 200, {
		'set-cookie': sessionCookieHeader('', req, 0),
	});
}

function normalizeFlyer(value: unknown): BannerFlyer | null | undefined {
	if (value === null) return null;
	if (!value || typeof value !== 'object') return undefined;
	const flyer = value as Partial<BannerFlyer>;
	const contentType = flyer.contentType;
	if (!flyer.key || !/^flyer\/[0-9a-f-]{36}$/i.test(flyer.key)) return undefined;
	if (
		contentType !== 'image/png' &&
		contentType !== 'image/jpeg' &&
		contentType !== 'image/webp' &&
		contentType !== 'application/pdf'
	) {
		return undefined;
	}
	return {
		key: flyer.key,
		name: asString(flyer.name).slice(0, 180) || 'flyer',
		contentType,
		size: Number(flyer.size) || 0,
	};
}

function bannerPayload(banner: Banner) {
	return { ...banner, version: bannerVersion(banner), active: isBannerActive(banner) };
}

async function uploadFlyer(req: Request): Promise<Response> {
	const type = req.headers.get('content-type') ?? '';
	if (!type.includes('multipart/form-data')) {
		throw new HttpError(400, { error: 'Upload the flyer as a file.' });
	}
	const form = await req.formData();
	const file = form.get('flyer');
	if (!(file instanceof File)) throw new HttpError(400, { error: 'Choose a flyer file.' });
	if (file.size > TOUR_DEFAULTS.flyerMaxBytes) {
		throw new HttpError(400, { error: 'Flyers need to be 8 MB or smaller.' });
	}
	const bytes = new Uint8Array(await file.arrayBuffer());
	const contentType = sniffFlyer(bytes, file.type);
	if (!contentType) {
		throw new HttpError(400, { error: 'Use a PNG, JPEG, WebP, or PDF flyer.' });
	}
	const saved = await saveFlyer(bytes, {
		name: file.name.replace(/[^\w.\- ]+/g, '').slice(0, 180) || 'flyer',
		contentType: contentType as FlyerContentType,
	});
	return json({ flyer: saved });
}

function parseTourDates(input: unknown): TourDateRecord[] {
	if (!Array.isArray(input)) throw new HttpError(400, { error: 'Send the tour dates as a list.' });
	const seen = new Set<string>();
	return input.map((item) => {
		if (!item || typeof item !== 'object') throw new HttpError(400, { error: 'A tour date is incomplete.' });
		const record = item as Record<string, unknown>;
		const date = asString(record.date).trim();
		const startTime = asString(record.startTime).trim();
		const endTime = asString(record.endTime).trim();
		const capacity = Number(record.capacity);
		if (!isIsoDate(date)) throw new HttpError(400, { error: `“${date || 'Date'}” is not a real date.` });
		if (seen.has(date)) throw new HttpError(400, { error: `${formatLongDate(date)} is listed twice.` });
		seen.add(date);
		if (!isHhmm(startTime) || !isHhmm(endTime) || startTime >= endTime) {
			throw new HttpError(400, { error: `${formatLongDate(date)} needs a start time before its end time.` });
		}
		if (!Number.isInteger(capacity) || capacity < 0 || capacity > 200) {
			throw new HttpError(400, { error: `${formatLongDate(date)} needs a capacity from 0 to 200.` });
		}
		return {
			id: date,
			date,
			startTime,
			endTime,
			capacity,
			enabled: record.enabled !== false && record.enabled !== 'false',
		};
	});
}

async function admin(req: Request): Promise<Response> {
	const { path, method } = routeOf(req);

	if (path === '/api/admin/session' && method === 'POST') return login(req);
	if (path === '/api/admin/session' && method === 'DELETE') return logout(req);

	const denied = adminDenied(req);
	if (denied) return denied;

	if (path === '/api/admin/session' && method === 'GET') return json({ ok: true });

	if (path === '/api/admin/banner' && method === 'GET') {
		const document = await readBannerDocument();
		return json({
			current: bannerPayload(document.current),
			history: document.history.map((banner) => bannerPayload(banner)),
		});
	}

	if (path === '/api/admin/banner' && method === 'PUT') {
		const body = await readJsonObject(req);
		const validation = validateBanner(body);
		if (!validation.value) return json({ error: 'Check the banner fields.', fields: validation.errors }, 400);
		const existing = await readBannerDocument();
		const flyer = normalizeFlyer(body.flyer);
		const saved = await saveBanner({
			...validation.value,
			flyer: flyer === undefined ? existing.current.flyer : flyer,
			modal: validation.value.modal,
			updatedAt: '',
		});
		return json({
			current: bannerPayload(saved.current),
			history: saved.history.map((banner) => bannerPayload(banner)),
		});
	}

	if (path === '/api/admin/banner/flyer' && method === 'POST') return uploadFlyer(req);

	if (path === '/api/admin/banner/flyer' && method === 'GET') {
		const key = routeOf(req).url.searchParams.get('key') ?? '';
		const file = await readFlyer(key);
		if (!file) return json({ error: 'That flyer is not on file.' }, 404);
		const contentType = file.metadata.contentType || 'application/octet-stream';
		return noStoreFile(Buffer.from(file.data), contentType, file.metadata.name || 'flyer');
	}

	if (path === '/api/admin/overview' && method === 'GET') {
		const today = chicagoToday();
		const [{ dates, source }, requests, interest] = await Promise.all([
			readTourDates(),
			listTourRequests(),
			listInterest(),
		]);
		return json({
			source,
			today,
			location: TOUR_DEFAULTS.location,
			grades: GRADE_OPTIONS,
			hearAbout: HEAR_ABOUT_OPTIONS,
			suggestedDates: defaultTourDates(today),
			dates: dates
				.slice()
				.sort((a, b) => a.date.localeCompare(b.date))
				.map((date) => ({
					...date,
					label: formatLongDate(date.date),
					timeLabel: formatTimeRange(date.startTime, date.endTime),
					booked: bookedCount(requests, date.id),
				})),
			requests: requests.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
			interest: interest.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
		});
	}

	if (path === '/api/admin/tour-dates' && method === 'PUT') {
		const body = await readJsonObject(req);
		const dates = parseTourDates(body.dates);
		const saved = await saveTourDates(dates);
		return json({ dates: saved });
	}

	if (path === '/api/admin/tour-requests/cancel' && method === 'POST') {
		const body = await readJsonObject(req);
		const id = asString(body.id);
		const cancelled = await cancelTourRequest(id);
		if (!cancelled) return json({ error: 'That request is not on file.' }, 404);
		return json({ ok: true });
	}

	if (path === '/api/admin/export' && method === 'GET') {
		const type = routeOf(req).url.searchParams.get('type');
		if (type === 'tours') {
			const [requests, { dates }] = await Promise.all([listTourRequests(), readTourDates()]);
			const labels = new Map(dates.map((date) => [date.id, formatLongDate(date.date)]));
			const csv = toCsv(
				requests.map((request) => ({ ...request, grades: request.grades.join(' '), tour: labels.get(request.tourDateId) ?? request.tourDateId })),
				[
					{ key: 'createdAt', label: 'Submitted' },
					{ key: 'status', label: 'Status' },
					{ key: 'tour', label: 'Tour' },
					{ key: 'parentName', label: 'Parent or guardian' },
					{ key: 'email', label: 'Email' },
					{ key: 'phone', label: 'Phone' },
					{ key: 'children', label: 'Children' },
					{ key: 'grades', label: 'Grades' },
					{ key: 'hearAbout', label: 'Heard about us' },
					{ key: 'message', label: 'Message' },
				],
			);
			return new Response(csv, {
				headers: {
					'content-type': 'text/csv; charset=utf-8',
					'content-disposition': 'attachment; filename="trinity-tour-requests.csv"',
					'cache-control': 'no-store',
					'x-robots-tag': 'noindex, nofollow',
				},
			});
		}
		if (type === 'interest') {
			const interest = await listInterest();
			const csv = toCsv(interest, [
				{ key: 'createdAt', label: 'Submitted' },
				{ key: 'name', label: 'Name' },
				{ key: 'email', label: 'Email' },
				{ key: 'phone', label: 'Phone' },
				{ key: 'pagePath', label: 'Page' },
				{ key: 'message', label: 'Note' },
			]);
			return new Response(csv, {
				headers: {
					'content-type': 'text/csv; charset=utf-8',
					'content-disposition': 'attachment; filename="trinity-interest.csv"',
					'cache-control': 'no-store',
					'x-robots-tag': 'noindex, nofollow',
				},
			});
		}
		return json({ error: 'Choose a tours or interest export.' }, 400);
	}

	return json({ error: 'Not found.' }, 404);
}

async function publicApi(req: Request): Promise<Response> {
	const { path, method } = routeOf(req);

	if (path === '/api/banner' && method === 'GET') {
		const document = await readBannerDocument();
		return json(toPublicBanner(document.current));
	}

	if (path === '/api/banner/flyer' && method === 'GET') {
		const document = await readBannerDocument();
		const flyer = document.current.flyer;
		if (!flyer || !isBannerActive(document.current)) return json({ error: 'No flyer is published.' }, 404);
		const file = await readFlyer(flyer.key);
		if (!file) return json({ error: 'No flyer is published.' }, 404);
		return noStoreFile(Buffer.from(file.data), flyer.contentType, flyer.name);
	}

	if (path === '/api/tours' && method === 'GET') return json(await publicTourSchedule());

	if (path === '/api/tour-requests' && method === 'POST') {
		const body = await readJsonObject(req);
		if (isHoneypotTripped(body)) {
			return json({ ok: true, honeypot: true });
		}
		const validation = validateTourRequest(body);
		if (!validation.value) {
			const fields: FieldErrors = validation.errors;
			return json({ error: errorSummary(Object.keys(fields).length), fields }, 400);
		}
		const result = await createTourRequest(validation.value);
		if (!result.ok && result.code === 'date_full') {
			return json(
				{
					error: 'That tour is full. Please choose another date.',
					code: 'date_full',
					fields: { tourDateId: 'That tour is full. Please choose another date.' },
				},
				409,
			);
		}
		if (!result.ok && result.code === 'date_unavailable') {
			return json(
				{
					error: 'Choose a tour date that is still open.',
					fields: { tourDateId: 'Choose a tour date that is still open.' },
				},
				400,
			);
		}
		if (!result.ok) return json({ error: 'We could not save that just now. Please try again.' }, 503);

		await notifySchool({
			type: 'tour_requested',
			text: describeTourRequest(result.request, result.date.label, result.date.timeLabel),
			data: {
				id: result.request.id,
				parentName: result.request.parentName,
				email: result.request.email,
				phone: result.request.phone,
				children: result.request.children,
				grades: result.request.grades,
				hearAbout: result.request.hearAbout,
				message: result.request.message,
				tourDate: result.date.date,
				tourLabel: result.date.label,
				timeLabel: result.date.timeLabel,
			},
		});

		return json({
			ok: true,
			givenName: givenName(result.request.parentName),
			email: result.request.email,
			dateLabel: result.date.label,
			timeLabel: result.date.timeLabel,
			location: TOUR_DEFAULTS.location,
			confirmationMessage: TOUR_DEFAULTS.confirmationMessage,
			whatToExpect: TOUR_DEFAULTS.whatToExpect,
		});
	}

	if (path === '/api/interest' && method === 'POST') {
		const body = await readJsonObject(req);
		if (isHoneypotTripped(body)) return json({ ok: true, honeypot: true });
		const validation = validateInterest(body);
		if (!validation.value) {
			return json(
				{ error: errorSummary(Object.keys(validation.errors).length), fields: validation.errors },
				400,
			);
		}
		const record = await createInterest(validation.value);
		await notifySchool({
			type: 'interest_submitted',
			text: describeInterest(record),
			data: {
				id: record.id,
				name: record.name,
				email: record.email,
				phone: record.phone,
				message: record.message,
				pagePath: record.pagePath,
			},
		});
		return json({
			ok: true,
			givenName: givenName(record.name),
		});
	}

	return json({ error: 'Not found.' }, 404);
}

export async function handleAdmissionsRequest(req: Request): Promise<Response> {
	const { path, method } = routeOf(req);
	const staff = path.startsWith('/api/admin');
	try {
		if (method === 'OPTIONS') {
			const response = staff ? preflight() : new Response(null, { status: 204 });
			return staff ? withCors(req, response) : response;
		}
		const response = staff ? await admin(req) : await publicApi(req);
		const tagged = staff ? withRobots(response) : response;
		return staff ? withCors(req, tagged) : tagged;
	} catch (error) {
		if (!(error instanceof HttpError)) console.error(error);
		const response = error instanceof HttpError ? json(error.body, error.status) : json({ error: 'Something went wrong.' }, 500);
		return staff ? withCors(req, withRobots(response)) : response;
	}
}
