import type { AstroGlobal } from 'astro';
import { runActions } from '../actions.ts';
import { csrfToken } from '../security.ts';
import { classReachMatch, importClassReach, skipClassReach, type ClassReachMatchItem, type ClassReachMatchStatus } from '@tca/school';

/**
 * Admin → ClassReach: the directory match (dry run) and the approved import.
 * Tabs filter by status; a row opens its sheet (?item=<key>) to settle a
 * conflict or skip it; the selection bar (or "Review import") opens the
 * confirm sheet (?sheet=import&ids=<keys>|ready) that posts the import.
 */
export const TABS: { value: '' | ClassReachMatchStatus; label: string }[] = [
	{ value: '', label: 'All' },
	{ value: 'matched', label: 'Matched' },
	{ value: 'new', label: 'New' },
	{ value: 'conflict', label: 'Conflicts' },
	{ value: 'imported', label: 'Imported' },
	{ value: 'skipped', label: 'Skipped' },
];
export const KINDS = [
	{ value: '', label: 'Everyone' },
	{ value: 'guardian', label: 'Guardians' },
	{ value: 'student', label: 'Students' },
];
export const STATUS_BADGE: Record<ClassReachMatchStatus, { label: string; class: string }> = {
	matched: { label: 'Matched', class: 'badge b-green' },
	new: { label: 'New', class: 'badge b-gold' },
	conflict: { label: 'Conflict', class: 'badge b-red' },
	imported: { label: 'Imported', class: 'badge b-gray' },
	skipped: { label: 'Skipped', class: 'badge b-gray' },
};
const importable = (item: ClassReachMatchItem) => item.status === 'matched' || item.status === 'new';
const open = (item: ClassReachMatchItem) => item.status !== 'imported' && item.status !== 'skipped';

export async function loadClassReachMatch(Astro: AstroGlobal, staff: NonNullable<AstroGlobal['locals']['family']>) {
	const csrf = csrfToken(Astro.cookies, Astro.url.protocol === 'https:');
	const by = Astro.locals.sessionEmail || staff.email || staff.name;
	const params = Astro.url.searchParams;
	const tab = TABS.some((item) => item.value === params.get('tab')) ? (params.get('tab') as '' | ClassReachMatchStatus) : '';
	const kind = KINDS.some((item) => item.value === params.get('kind')) ? params.get('kind')! : '';
	const listHref = (() => {
		const url = new URL('/admin/classreach', Astro.url);
		if (tab) url.searchParams.set('tab', tab);
		if (kind) url.searchParams.set('kind', kind);
		return url.pathname + url.search;
	})();
	const withParam = (key: string, value: string) => `${listHref}${listHref.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;

	const result = await runActions(Astro, {
		import: async (form) => {
			const keys = String(form.get('keys') ?? '').split(',').map((key) => key.trim()).filter(Boolean);
			const key = String(form.get('key') ?? '');
			const target = String(form.get('target') ?? '');
			const outcome = await importClassReach({ keys, targets: key && target ? { [key]: target } : {}, by });
			if (!outcome.ok) return { error: outcome.error };
			if (key && outcome.imported === 0) return { error: 'That one still needs a decision: pick a family for it.' };
			return { redirect: `${withParam('imported', String(outcome.imported))}${outcome.needsDecision ? `&left=${outcome.needsDecision}` : ''}` };
		},
		skip: async (form) => {
			const keys = String(form.get('keys') ?? '').split(',').map((key) => key.trim()).filter(Boolean);
			const skip = form.get('skip') === 'yes';
			const outcome = await skipClassReach({ keys, skip, by });
			return outcome.ok ? { redirect: withParam(skip ? 'skipped' : 'restored', String(outcome.count)) } : { error: outcome.error };
		},
	});
	if ('redirect' in result) return Astro.redirect(result.redirect, 303);

	const match = await classReachMatch();
	const items = match.items.filter((item) => (!tab || item.status === tab) && (!kind || item.kind === kind));
	const selected = params.get('item') ? match.items.find((item) => item.key === params.get('item')) ?? null : null;
	// The confirm sheet: the picked rows, or everything ready ("ready").
	const sheet = params.get('sheet') || '';
	const ids = params.get('ids') || '';
	const wanted = new Set(ids.split(','));
	const picked = sheet !== 'import' ? [] : ids === 'ready' ? match.items.filter(importable) : match.items.filter((item) => wanted.has(item.key) && open(item));
	const skipPicked = sheet === 'skip' ? match.items.filter((item) => wanted.has(item.key) && open(item)) : [];
	const plan = {
		link: picked.filter((item) => item.action === 'link').length,
		families: picked.filter((item) => item.action === 'create_family').length,
		children: picked.filter((item) => item.action === 'add_child').length,
		students: picked.filter((item) => item.action === 'link_child').length,
		undecided: picked.filter((item) => item.status === 'conflict').length,
	};
	const ready = match.items.filter(importable).length;
	const tabCount = (value: '' | ClassReachMatchStatus) => value ? match.summary[value] : match.items.length;
	return {
		csrf, result, match, items, selected, tab, kind, listHref, withParam, picked, plan, ready, tabCount,
		skipPicked, importOpen: sheet === 'import' && ids !== '', skipOpen: sheet === 'skip' && ids !== '', itemHref: (item: ClassReachMatchItem) => withParam('item', item.key),
		tabHref: (value: string) => {
			const url = new URL('/admin/classreach', Astro.url);
			if (value) url.searchParams.set('tab', value);
			if (kind) url.searchParams.set('kind', kind);
			return url.pathname + url.search;
		},
		selectable: open,
	};
}
