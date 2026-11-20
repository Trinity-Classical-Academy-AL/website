import type { AstroGlobal } from 'astro';
import { runActions } from '../actions.ts';
import { csrfToken } from '../security.ts';
import { attachEmailsToFamily, listFamilyAccounts, listIncoming, listStudents, listUpdateSignups, mergeFamilies } from '@tca/school';
import { FOLLOW_UPS, STAGES, buildDirectory, findFamily, type DirectoryFamily, type FollowUp } from './families.ts';

/**
 * Merge confirmation for families picked on the Families list (?ids=a,b,c).
 * One family with a portal account stays (?keep=); the others move into it.
 * Accounts merge fully (mergeFamilies); email-only families add their emails.
 */
const stageRank = (row: DirectoryFamily) => STAGES.findIndex((stage) => stage.value === row.stage);
// Most urgent follow-up wins in the preview.
const FOLLOW_ORDER: FollowUp[] = ['overdue', 'new', 'contacted', 'confirmed', 'cancelled', ''];

export async function loadFamilyMerge(Astro: AstroGlobal, staff: NonNullable<AstroGlobal['locals']['family']>) {
	const csrf = csrfToken(Astro.cookies, Astro.url.protocol === 'https:');
	const by = Astro.locals.sessionEmail || staff.email || staff.name;
	const [accounts, inquiries, signups] = await Promise.all([listFamilyAccounts(), listIncoming(), listUpdateSignups()]);
	const directory = buildDirectory(accounts, inquiries, signups);
	const ids = (Astro.url.searchParams.get('ids') || '').split(',').map((id) => id.trim()).filter(Boolean);
	const families = [...new Map(ids.map((id) => findFamily(directory, id)).filter((row): row is DirectoryFamily => !!row).map((row) => [row.key, row])).values()];
	const withAccount = families.filter((row) => row.account);

	const result = await runActions(Astro, {
		merge: async (form) => {
			const keep = withAccount.find((row) => row.account!.id === form.get('keep'));
			if (!keep || families.length < 2) return { error: 'Choose the family to keep.' };
			for (const row of families) {
				if (row === keep) continue;
				const outcome = row.account
					? await mergeFamilies({ fromFamilyId: row.account.id, toFamilyId: keep.account!.id, by, staff: true })
					: await attachEmailsToFamily(keep.account!.id, row.emails, by);
				if (!outcome.ok) return { error: outcome.error };
			}
			return { redirect: `/admin/families/${keep.account!.id}?merged=1` };
		},
	});
	if ('redirect' in result) return Astro.redirect(result.redirect, result.status);

	// Default keeper: enrolled first, then the furthest stage, then the oldest account.
	const ranked = [...withAccount].sort((a, b) => stageRank(b) - stageRank(a) || Date.parse(a.account!.createdAt) - Date.parse(b.account!.createdAt));
	const keep = withAccount.find((row) => row.account!.id === Astro.url.searchParams.get('keep')) ?? ranked[0] ?? null;
	const students = new Map(await Promise.all(withAccount.map(async (row) => [row.key, await listStudents(row.account!.id)] as const)));

	// What the combined family will look like.
	const emails = [...new Set([...(keep?.emails ?? []), ...families.flatMap((row) => row.emails)])];
	// Children are not combined: every entry carries over, so list each one with
	// the family it comes from and flag names that repeat.
	const familyLabel = (row: DirectoryFamily) => row.name || row.emails[0];
	const entries = families.flatMap((row) => row.children.map((name) => ({ name, from: familyLabel(row) })));
	const seen = new Map<string, number>();
	for (const child of entries) seen.set(child.name.toLowerCase(), (seen.get(child.name.toLowerCase()) ?? 0) + 1);
	const children = entries.map((child) => ({ ...child, duplicate: (seen.get(child.name.toLowerCase()) ?? 0) > 1 }));
	const enrolledWithStudents = withAccount.filter((row) => (students.get(row.key)?.length ?? 0) > 0);
	const preview = keep && {
		name: keep.name || keep.emails[0],
		emails,
		children,
		students: withAccount.flatMap((row) => students.get(row.key) ?? []),
		stage: [...families].sort((a, b) => stageRank(b) - stageRank(a))[0].stage,
		followUp: FOLLOW_ORDER.find((value) => families.some((row) => row.followUp === value)) ?? '',
		inquiries: families.reduce((sum, row) => sum + row.inquiries.length, 0),
		tours: families.filter((row) => row.tour).map((row) => row.tour),
		firstAt: families.map((row) => row.firstAt).sort()[0],
	};
	return {
		csrf, error: result.error, ids, families, withAccount, keep, preview, students,
		warnings: {
			missing: ids.length > families.length,
			noAccount: withAccount.length === 0,
			bothEnrolled: enrolledWithStudents.length > 1,
			duplicateChildren: [...new Set(children.filter((child) => child.duplicate).map((child) => child.name))],
		},
		followLabel: (value: FollowUp) => FOLLOW_UPS.find((item) => item.value === value)?.label ?? '—',
	};
}

export type FamilyMergeView = Exclude<Awaited<ReturnType<typeof loadFamilyMerge>>, Response>;
