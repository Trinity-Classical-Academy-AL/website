import type { AstroGlobal } from 'astro';
import { runActions } from '../actions.ts';
import { csrfToken } from '../security.ts';
import { hideFamilies, listApplications, listFamilyAccounts, listIncoming, listUpdateSignups } from '@tca/school';
import { buildDirectory, findFamily, type DirectoryFamily } from './families.ts';

/**
 * Remove families picked on the Families list (?ids=a,b,c) as noise: test
 * sign-ups, spam inquiries. A soft delete: they leave the list (isHidden) but
 * keep their records and can still sign in. New activity brings them back.
 */
const list = (param: string | null) => (param || '').split(',').map((value) => value.trim()).filter(Boolean);

export async function loadFamilyRemove(Astro: AstroGlobal, staff: NonNullable<AstroGlobal['locals']['family']>) {
	const csrf = csrfToken(Astro.cookies, Astro.url.protocol === 'https:');
	const by = Astro.locals.sessionEmail || staff.email || staff.name;
	const [accounts, inquiries, signups, applications] = await Promise.all([listFamilyAccounts(), listIncoming(), listUpdateSignups(), listApplications()]);
	const directory = buildDirectory(accounts, inquiries, signups, Date.now(), applications);
	const families: DirectoryFamily[] = [...new Map(list(Astro.url.searchParams.get('ids')).map((id) => findFamily(directory, id)).filter((row): row is DirectoryFamily => !!row).map((row) => [row.key, row])).values()];

	const result = await runActions(Astro, {
		remove: async () => {
			if (!families.length) return { error: 'Select families to remove.' };
			await hideFamilies(families.flatMap((row) => [row.account?.id ?? '', ...row.emails]), by);
			return { redirect: `/admin/families?removed=${families.length}` };
		},
	});
	if ('redirect' in result) return Astro.redirect(result.redirect, result.status);
	return {
		csrf, error: result.error, families,
		/** Worth a second look before removing: real households, not noise. */
		real: families.filter((row) => row.account || row.applications.length || row.stage === 'enrolled'),
	};
}
