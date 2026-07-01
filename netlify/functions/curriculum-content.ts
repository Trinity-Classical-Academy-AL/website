import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/functions';
import {
	defaultCurriculumContent,
	renderCurriculumMarkdown,
	validateCurriculumContent,
} from '../../src/lib/curriculumContent';

const jsonHeaders = {
	'Content-Type': 'application/json; charset=utf-8',
	'Cache-Control': 'no-store',
};

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
	new Response(JSON.stringify(body), {
		...init,
		headers: {
			...jsonHeaders,
			...(init.headers ?? {}),
		},
	});

const getAdminToken = () => {
	const netlify = globalThis.Netlify as
		| { env?: { get?: (name: string) => string | undefined } }
		| undefined;

	return netlify?.env?.get?.('CURRICULUM_ADMIN_TOKEN') ?? '';
};

const isAuthorized = (req: Request) => {
	const expectedToken = getAdminToken();
	const header = req.headers.get('Authorization') ?? '';
	const submittedToken = header.replace(/^Bearer\s+/i, '').trim();

	return expectedToken.length > 0 && submittedToken === expectedToken;
};

const publicContent = (
	content: {
		title: string;
		bodyMarkdown: string;
		updatedAt?: string;
	},
	isDefault = false,
) => ({
	title: content.title,
	bodyMarkdown: content.bodyMarkdown,
	html: renderCurriculumMarkdown(content.bodyMarkdown),
	updatedAt: content.updatedAt ?? null,
	isDefault,
});

export default async (req: Request) => {
	const store = getStore({ name: 'site-content', consistency: 'strong' });

	if (req.method === 'GET') {
		const storedContent = await store.get('curriculum', { type: 'json' });
		const validation = validateCurriculumContent(storedContent);

		if (validation.ok) {
			return jsonResponse(
				publicContent({
					...validation.value,
					updatedAt:
						storedContent && typeof storedContent === 'object' && 'updatedAt' in storedContent
							? String(storedContent.updatedAt)
							: undefined,
				}),
			);
		}

		return jsonResponse(publicContent(defaultCurriculumContent, true));
	}

	if (req.method === 'PUT') {
		if (!getAdminToken()) {
			return jsonResponse(
				{ error: 'Admin access is not configured.' },
				{ status: 503 },
			);
		}

		if (!isAuthorized(req)) {
			return jsonResponse({ error: 'Unauthorized.' }, { status: 401 });
		}

		let payload: unknown;

		try {
			payload = await req.json();
		} catch {
			return jsonResponse({ error: 'Request body must be JSON.' }, { status: 400 });
		}

		const validation = validateCurriculumContent(payload);

		if (!validation.ok) {
			return jsonResponse({ error: validation.error }, { status: 400 });
		}

		const savedContent = {
			...validation.value,
			updatedAt: new Date().toISOString(),
		};

		await store.setJSON('curriculum', savedContent);

		return jsonResponse(publicContent(savedContent));
	}

	return jsonResponse({ error: 'Method not allowed.' }, { status: 405 });
};

export const config: Config = {
	path: '/api/curriculum',
	method: ['GET', 'PUT'],
};
