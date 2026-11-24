import type { APIRoute } from 'astro';
import { paymentProvider, recordEntry } from '@tca/school';

export const prerender = false;

/**
 * Where a payment processor's events will land. Unknown providers, and providers without
 * webhooks (manual), get 404. Every write goes through recordEntry, like a manual payment.
 * Middleware lets this path through without a session; each provider must verify its own signature.
 */
export const POST: APIRoute = async ({ params, request }) => {
	const provider = paymentProvider(params.provider ?? '');
	if (!provider?.handleWebhook) return new Response('Not found', { status: 404 });
	const result = await provider.handleWebhook(request);
	if (!result.ok) return new Response(result.error, { status: 400 });
	for (const entry of result.entries) {
		const saved = await recordEntry({ ...entry, provider: provider.id }, `provider:${provider.id}`);
		if (!saved.ok) return new Response(saved.error, { status: 422 });
	}
	return new Response('ok', { status: 200 });
};

export const GET: APIRoute = () => new Response('Not found', { status: 404 });
