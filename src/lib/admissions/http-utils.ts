import { TOUR_DEFAULTS } from './defaults.ts';
import { asString } from './validation.ts';

export class HttpError extends Error {
	status: number;
	body: Record<string, unknown>;

	constructor(status: number, body: Record<string, unknown>) {
		super(asString(body.error) || `HTTP ${status}`);
		this.status = status;
		this.body = body;
	}
}

export function json(body: unknown, status = 200, extra?: HeadersInit): Response {
	const headers = new Headers(extra);
	headers.set('content-type', 'application/json; charset=utf-8');
	headers.set('cache-control', 'no-store');
	return new Response(JSON.stringify(body), { status, headers });
}

export function routeOf(req: Request): { path: string; method: string; url: URL } {
	const url = new URL(req.url);
	const path = url.pathname.replace(/\/+$/, '') || '/';
	return { path, method: req.method.toUpperCase(), url };
}

export async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
	const type = req.headers.get('content-type') ?? '';
	if (!type.includes('application/json')) {
		throw new HttpError(400, { error: 'Request body must be JSON.' });
	}
	try {
		const data = (await req.json()) as unknown;
		if (!data || typeof data !== 'object' || Array.isArray(data)) {
			throw new HttpError(400, { error: 'Request body must be a JSON object.' });
		}
		return data as Record<string, unknown>;
	} catch (error) {
		if (error instanceof HttpError) throw error;
		throw new HttpError(400, { error: 'Request body must be JSON.' });
	}
}

export function noStoreFile(body: BodyInit, contentType: string, filename: string): Response {
	const ascii = filename.replace(/[^\w.\-]+/g, '_') || 'flyer';
	return new Response(body, {
		headers: {
			'content-type': contentType,
			'content-disposition': `inline; filename="${ascii}"`,
			'cache-control': 'no-store',
			'x-content-type-options': 'nosniff',
		},
	});
}

export const SESSION_MAX_AGE = TOUR_DEFAULTS.sessionDays * 24 * 60 * 60;
