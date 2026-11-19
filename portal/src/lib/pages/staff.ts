import type { AstroGlobal } from 'astro';
import { runActions, redirectOnSuccess, toastFrom } from '../actions.ts';
import { csrfToken } from '../security.ts';
import { formatChicago, inviteStaff, listFamilies, removeStaffAccess } from '@tca/school';

/** Load data, run the existing actions, then derive the page's render model. */
export async function loadStaff(Astro: AstroGlobal, family: NonNullable<AstroGlobal['locals']['family']>) {
	const secure = Astro.url.protocol === 'https:';
	const csrf = csrfToken(Astro.cookies, secure);
	let error = '';
	const actionResult = await runActions(Astro, {
		remove: async (form) => redirectOnSuccess(await removeStaffAccess(family.id, String(form.get('id') ?? '')), '/admin/staff'),
	}, {
		fallback: async (form) => {
			const email = String(form.get('email') ?? '').trim();
			if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
				await inviteStaff(email);
				return { redirect: `/admin/staff?invited=${encodeURIComponent(email)}` };
			}
			return { error: 'Enter an email address like name@example.com.' };
		},
	});
	
	if ('redirect' in actionResult) return Astro.redirect(actionResult.redirect);
	error = actionResult.error;
	const staff = (await listFamilies('')).filter((person) => person.roles.includes('admin'));
	const removing = staff.find((person) => person.id === Astro.url.searchParams.get('remove'));
	const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
	const seen = (iso: string | null) => {
		if (!iso) return 'Never';
		const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(iso));
		return day === today ? 'Today' : formatChicago(iso, false);
	};
	const toast = toastFrom(Astro.url, { invited: email => `Invite sent to ${email}.` });
	return { family, csrf, error, staff, removing, seen, toast };
}

export type StaffView = Exclude<Awaited<ReturnType<typeof loadStaff>>, Response>;
