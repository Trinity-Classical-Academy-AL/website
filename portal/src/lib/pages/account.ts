import type { AstroGlobal } from 'astro';
import { runActions, toastFrom } from '../actions.ts';
import { csrfToken } from '../security.ts';
import { FAMILY_COOKIE, FAMILY_SESSION_DAYS, adminLossOnRemove, changePassword, clearEmailPassword, emailOpensAdmin, formatChicago, issueFamilySession, listSignInEmails, makePrimary, notificationChoices, removeSignInEmail, renameFamily, resendEmailCode, saveNotifications, setEmailPassword, startAddEmail, unlinkGoogle, verifyEmailCode } from '@tca/school';

/** Load data, run the existing actions, then derive the page's render model. */
export async function loadAccount(Astro: AstroGlobal, family: NonNullable<AstroGlobal['locals']['family']>) {
	const secure = Astro.url.protocol === 'https:';
	const csrf = csrfToken(Astro.cookies, secure);
	const back = (params: Record<string, string>) => {
		const url = new URL('/account', Astro.url);
		for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
		return url.pathname + url.search;
	};
	function accountResult(result: import('@tca/school').Result, notice: string, params: Record<string, string> = {}) {
		return { redirect: back(result.ok ? { notice } : { ...params, error: result.error }) };
	}
	const actionResult = await runActions(Astro, {
		add: async (form) => {
			const result = await startAddEmail(family.id, String(form.get('email') ?? ''));
			return { redirect: back(result.ok ? { dialog: 'verify', email: result.email } : { error: result.error }) };
		},
		resend: async (form) => {
			const result = await resendEmailCode(family.id, String(form.get('email') ?? ''));
			return { redirect: back(result.ok ? { dialog: 'verify', email: String(form.get('email') ?? ''), notice: 'We sent a new code.' } : { error: result.error }) };
		},
		verify: async (form) => {
			const email = String(form.get('email') ?? '');
			return accountResult(await verifyEmailCode(family.id, email, String(form.get('code') ?? '')), 'Email verified.', { dialog: 'verify', email });
		},
		primary: async (form) => accountResult(await makePrimary(family.id, String(form.get('id') ?? '')), 'Primary email updated.'),
		remove: async (form) => {
			const result = await removeSignInEmail(family.id, String(form.get('id') ?? ''), String(form.get('confirm') ?? ''));
			if (result.ok && result.email === Astro.locals.sessionEmail) {
				const primary = (await listSignInEmails(family.id)).find((item) => item.primary);
				if (primary) {
					Astro.cookies.set(FAMILY_COOKIE, issueFamilySession(family.id, primary.email), {
						httpOnly: true, path: '/', sameSite: 'lax', secure, maxAge: FAMILY_SESSION_DAYS * 86400,
					});
				}
			}
			return accountResult(result, 'Email removed.');
		},
		unlink: async (form) => accountResult(await unlinkGoogle(family.id, String(form.get('id') ?? '')), 'Google unlinked.'),
		'password-on': async (form) => {
			const id = String(form.get('id') ?? '');
			return accountResult(await setEmailPassword(family.id, id, String(form.get('password') ?? '')), 'Password sign-in is on.', { dialog: 'password-on', id });
		},
		'password-off': async (form) => accountResult(await clearEmailPassword(family.id, String(form.get('id') ?? '')), 'Password sign-in is off.'),
		password: async (form) => accountResult(await changePassword(family.id, String(form.get('current') ?? ''), String(form.get('password') ?? '')), 'Password saved.', { dialog: 'password' }),
		name: async (form) => accountResult(await renameFamily(family.id, String(form.get('name') ?? '')), 'Name saved.', { dialog: 'name' }),
		notify: async (form) => accountResult(await saveNotifications(family.id, {
			announcements: String(form.get('announcements') ?? ''), tours: String(form.get('tours') ?? ''), admin: String(form.get('admin') ?? ''),
		}), 'Notifications saved.'),
	}, {
		actionFrom: (form) => { const actions = form.getAll('action').map(String); return actions.includes('resend') ? 'resend' : actions[0] || ''; },
		csrfFailure: (error) => ({ redirect: back({ error }) }),
		fallback: async () => ({ redirect: back({ notice: '' }) }),
	});
	if ('redirect' in actionResult) return Astro.redirect(actionResult.redirect, actionResult.status);
	const [emails, routes] = await Promise.all([listSignInEmails(family.id), notificationChoices(family.id)]);
	const dialog = Astro.url.searchParams.get('dialog') || '';
	const focusId = Astro.url.searchParams.get('id') || '';
	const verifyAddress = Astro.url.searchParams.get('email') || '';
	const error = Astro.url.searchParams.get('error') || '';
	const notice = toastFrom(Astro.url, { notice: value => value });
	const focus = emails.find((item) => item.id === focusId);
	const losesAdmin = dialog === 'remove' && focus ? await adminLossOnRemove(family.id, focus.id) : false;
	const verified = emails.filter((item) => item.verified);
	const adminChoices = verified.filter((item) => emailOpensAdmin(item.email));
	const showAdminRoute = family.roles.includes('admin') && adminChoices.length > 0;
	const fresh = family;
	const changed = fresh?.passwordChangedAt ? formatChicago(fresh.passwordChangedAt, false) : '';
	return { csrf, back, emails, routes, dialog, verifyAddress, error, notice, focus, losesAdmin, verified, adminChoices, showAdminRoute, fresh, changed };
}

export type AccountView = Exclude<Awaited<ReturnType<typeof loadAccount>>, Response>;
