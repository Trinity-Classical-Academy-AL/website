import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'];

export function judgeStatus(root) {
	const key = KEYS.find((name) => process.env[name]);
	const ceiling = existsSync(join(root, 'anchors/ceiling')) ? readdirSync(join(root, 'anchors/ceiling')).filter((name) => name.endsWith('.png')).length : 0;
	const floor = existsSync(join(root, 'anchors/floor')) ? readdirSync(join(root, 'anchors/floor')).filter((name) => name.endsWith('.png')).length : 0;
	if (!key) {
		return { enabled: false, reason: 'No LLM API key is set. Export OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, or GOOGLE_API_KEY. Judges stay off rather than inventing scores.' };
	}
	if (ceiling < 2 || floor < 1) {
		return { enabled: false, reason: `Anchors are incomplete (ceiling ${ceiling}, floor ${floor}). Add screenshots under anchors/ before a round is scored.` };
	}
	return { enabled: true, provider: key, ceiling, floor };
}

export async function scoreRound() {
	const status = judgeStatus(new URL('.', import.meta.url).pathname);
	if (!status.enabled) return { ...status, scores: [] };
	throw new Error('Judge transport is not wired until a key and the anchor screenshots are both present.');
}
