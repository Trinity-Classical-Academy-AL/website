type PostHogLike = { capture?: (event: string, properties?: Record<string, unknown>) => void };

export function capture(event: string, properties: Record<string, unknown> = {}) {
	const posthog = (window as Window & { posthog?: PostHogLike }).posthog;
	posthog?.capture?.(event, { page_path: location.pathname, ...properties });
}
