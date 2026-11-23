import type { AstroGlobal } from 'astro';
import { runActions } from '../actions.ts';
import { csrfToken } from '../security.ts';
import {
	attachEmailsToFamily, combineChildEntries, listChildEntries, listFamilyAccounts, listIncoming, listUpdateSignups, mergeFamilies,
	type ChildEntry,
} from '@tca/school';
import { FOLLOW_UPS, STAGES, buildDirectory, findFamily, type DirectoryFamily, type FollowUp } from './families.ts';

/**
 * Merge confirmation for families picked on the Families list (?ids=a,b,c).
 * One family with a portal account stays (?keep=); the others move into it.
 * Accounts merge fully (mergeFamilies); email-only families add their emails.
 *
 * Children: entries with the same name in different families are combined by
 * default (?split=<id> keeps one separate). Any other two can be marked as the
 * same child (?pair=<id>:<id>). The confirm form posts the final pairs.
 */
const stageRank = (row: DirectoryFamily) => STAGES.findIndex((stage) => stage.value === row.stage);
// Most urgent follow-up wins in the preview.
const FOLLOW_ORDER: FollowUp[] = ['overdue', 'new', 'contacted', 'confirmed', 'cancelled', ''];
const nameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
const list = (param: string | null) => (param || '').split(',').map((value) => value.trim()).filter(Boolean);

export type ChildView = ChildEntry & { family: string };
export type ChildGroup = { keep: ChildView; drops: ChildView[]; auto: boolean };

export async function loadFamilyMerge(Astro: AstroGlobal, staff: NonNullable<AstroGlobal['locals']['family']>) {
	const csrf = csrfToken(Astro.cookies, Astro.url.protocol === 'https:');
	const by = Astro.locals.sessionEmail || staff.email || staff.name;
	const params = Astro.url.searchParams;
	const [accounts, inquiries, signups] = await Promise.all([listFamilyAccounts(), listIncoming(), listUpdateSignups()]);
	const directory = buildDirectory(accounts, inquiries, signups);
	const ids = list(params.get('ids'));
	const families = [...new Map(ids.map((id) => findFamily(directory, id)).filter((row): row is DirectoryFamily => !!row).map((row) => [row.key, row])).values()];
	const withAccount = families.filter((row) => row.account);
	// Default keeper: enrolled first, then the furthest stage, then the oldest account.
	const ranked = [...withAccount].sort((a, b) => stageRank(b) - stageRank(a) || Date.parse(a.account!.createdAt) - Date.parse(b.account!.createdAt));
	const keep = withAccount.find((row) => row.account!.id === params.get('keep')) ?? ranked[0] ?? null;
	const familyLabel = (row: DirectoryFamily) => row.name || row.emails[0];
	const labelFor = new Map(withAccount.map((row) => [row.account!.id, familyLabel(row)]));

	// ---- children ----
	const entries: ChildView[] = (await listChildEntries(withAccount.map((row) => row.account!.id)))
		.map((entry) => ({ ...entry, family: labelFor.get(entry.familyId) ?? '' }));
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	// Which entry survives a combine: a student over a prospect entry, then the kept family's.
	const better = (a: ChildView, b: ChildView) => (a.kind === 'student') !== (b.kind === 'student') ? (a.kind === 'student' ? a : b)
		: (a.familyId === keep?.account?.id) !== (b.familyId === keep?.account?.id) ? (a.familyId === keep?.account?.id ? a : b) : a;
	const split = new Set(list(params.get('split')));
	const groups: ChildGroup[] = [];
	const grouped = new Set<string>();
	// Same name in different families: combine unless split.
	const byName = new Map<string, ChildView[]>();
	for (const entry of entries) byName.set(nameKey(entry.name), [...(byName.get(nameKey(entry.name)) ?? []), entry]);
	for (const same of byName.values()) {
		if (new Set(same.map((entry) => entry.familyId)).size < 2) continue;
		const candidates = same.filter((entry) => !split.has(entry.id));
		if (candidates.length < 2) continue;
		const winner = candidates.reduce(better);
		groups.push({ keep: winner, drops: candidates.filter((entry) => entry !== winner), auto: true });
		candidates.forEach((entry) => grouped.add(entry.id));
	}
	const autoSplit = [...byName.values()].filter((same) => new Set(same.map((entry) => entry.familyId)).size > 1 && same.some((entry) => split.has(entry.id)));
	// Manual pairs from "Same child as…".
	const pairs = list(params.get('pair')).map((pair) => pair.split(':')).filter(([a, b]) => byId.has(a) && byId.has(b) && a !== b && !grouped.has(a) && !grouped.has(b));
	for (const [a, b] of pairs) {
		if (grouped.has(a) || grouped.has(b)) continue;
		const winner = better(byId.get(a)!, byId.get(b)!);
		groups.push({ keep: winner, drops: [winner.id === a ? byId.get(b)! : byId.get(a)!], auto: false });
		grouped.add(a); grouped.add(b);
	}
	// A student never gets folded into a prospect-only entry; better() already prefers students,
	// so two students can combine, and a prospect entry folds into a student.
	const singles = entries.filter((entry) => !grouped.has(entry.id));
	const combine = groups.flatMap((group) => group.drops.map((drop) => ({ keep: group.keep.id, drop: drop.id })));
	const finalChildren = [...groups.map((group) => ({ name: group.keep.name, detail: group.keep.detail || group.drops.find((drop) => drop.detail)?.detail || '', from: [group.keep, ...group.drops].map((entry) => entry.family), combined: true })),
		...singles.map((entry) => ({ name: entry.name, detail: entry.detail, from: [entry.family], combined: false }))];

	const result = await runActions(Astro, {
		merge: async (form) => {
			const kept = withAccount.find((row) => row.account!.id === form.get('keep'));
			if (!kept || families.length < 2) return { error: 'Choose the family to keep.' };
			for (const row of families) {
				if (row === kept) continue;
				const outcome = row.account
					? await mergeFamilies({ fromFamilyId: row.account.id, toFamilyId: kept.account!.id, by, staff: true })
					: await attachEmailsToFamily(kept.account!.id, row.emails, by);
				if (!outcome.ok) return { error: outcome.error };
			}
			const chosen = form.getAll('combine').map(String).map((pair) => pair.split(':')).filter((pair) => pair.length === 2).map(([keepId, drop]) => ({ keep: keepId, drop }));
			const combined = await combineChildEntries(kept.account!.id, chosen, by);
			if (!combined.ok) return { error: combined.error };
			return { redirect: `/admin/families/${kept.account!.id}?merged=1` };
		},
	});
	if ('redirect' in result) return Astro.redirect(result.redirect, result.status);

	/** This page's URL with some params changed ('' removes one). */
	const link = (changes: Record<string, string>) => {
		const url = new URL(Astro.url);
		for (const [key, value] of Object.entries(changes)) value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
		return url.pathname + url.search + '#children';
	};
	const splitLink = (ids: string[], on: boolean) => link({ split: [...(on ? new Set([...split, ...ids]) : new Set([...split].filter((id) => !ids.includes(id))))].join(',') });
	const pairParam = list(params.get('pair'));
	const unpairLink = (group: ChildGroup) => link({ pair: pairParam.filter((pair) => !pair.split(':').every((id) => [group.keep.id, ...group.drops.map((drop) => drop.id)].includes(id))).join(',') });

	const emails = [...new Set([...(keep?.emails ?? []), ...families.flatMap((row) => row.emails)])];
	const preview = keep && {
		name: keep.name || keep.emails[0],
		emails,
		children: finalChildren,
		stage: [...families].sort((a, b) => stageRank(b) - stageRank(a))[0].stage,
		followUp: FOLLOW_ORDER.find((value) => families.some((row) => row.followUp === value)) ?? '',
		inquiries: families.reduce((sum, row) => sum + row.inquiries.length, 0),
		tours: families.filter((row) => row.tour).map((row) => row.tour),
		firstAt: families.map((row) => row.firstAt).sort()[0],
	};
	return {
		csrf, error: result.error, ids, families, withAccount, keep, preview,
		children: { groups, autoSplit, singles, combine, entries },
		link, splitLink, unpairLink, pairParam,
		warnings: { bothEnrolled: withAccount.filter((row) => entries.some((entry) => entry.kind === 'student' && entry.familyId === row.account!.id)).length > 1 },
		followLabel: (value: FollowUp) => FOLLOW_UPS.find((item) => item.value === value)?.label ?? '—',
	};
}

export type FamilyMergeView = Exclude<Awaited<ReturnType<typeof loadFamilyMerge>>, Response>;
