import { isBannerActive, toPublicBanner } from './banner.ts';
import { TOUR_DEFAULTS } from './defaults.ts';
import { HttpError, json, noStoreFile, readJsonObject, routeOf } from './http-utils.ts';
import { subscribeUpdates } from '@tca/school';
import { createInterest, createTourRequest, publicTourSchedule, readBannerDocument, readFlyer } from './repository.ts';
import { errorSummary, givenName, isHoneypotTripped, validateInterest, validateTourRequest, type FieldErrors } from './validation.ts';

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
		if (isHoneypotTripped(body)) return json({ ok: true, honeypot: true });
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

	if (path === '/api/updates' && method === 'POST') {
		const body = await readJsonObject(req);
		const email = String(body.email ?? '').trim().toLowerCase();
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter an email address like name@example.com.' }, 400);
		await subscribeUpdates(email, String(body.source ?? 'website'));
		return json({ ok: true });
	}

	if (path === '/api/interest' && method === 'POST') {
		const body = await readJsonObject(req);
		if (isHoneypotTripped(body)) return json({ ok: true, honeypot: true });
		const validation = validateInterest(body);
		if (!validation.value) {
			return json({ error: errorSummary(Object.keys(validation.errors).length), fields: validation.errors }, 400);
		}
		const record = await createInterest(validation.value);
		return json({ ok: true, givenName: givenName(record.name) });
	}

	return json({ error: 'Not found.' }, 404);
}

export async function handleAdmissionsRequest(req: Request): Promise<Response> {
	const { method } = routeOf(req);
	try {
		if (method === 'OPTIONS') return new Response(null, { status: 204 });
		return await publicApi(req);
	} catch (error) {
		if (!(error instanceof HttpError)) console.error(error);
		const message = error instanceof Error && error.message.includes('DATABASE_URL')
			? 'The school database is not configured.'
			: 'Something went wrong.';
		return error instanceof HttpError ? json(error.body, error.status) : json({ error: message }, 500);
	}
}
