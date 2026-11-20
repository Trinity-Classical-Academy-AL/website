import type { AstroGlobal } from 'astro';
import { runActions, toastFrom } from '../actions.ts';
import { csrfToken } from '../security.ts';
import { FAMILY_COOKIE, FAMILY_SESSION_DAYS, adminLossOnRemove, changePassword, clearEmailPassword, emailOpensAdmin, formatChicago, issueFamilySession, listSignInEmails, makePrimary, notificationChoices, removeSignInEmail, renameFamily, resendEmailCode, saveNotifications, setEmailPassword, startAddEmail, unlinkGoogle, verifyEmailCode, addGuardian, claimEmail, currentGuardian, listGuardians, readHouseholdName, removeGuardian, renameGuardian, saveHouseholdName, answerJoinRequest, answeringFamily, cancelJoinRequest, inviteToFamily, listJoinRequests, requestToJoin } from '@tca/school';

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
	// The signed-in person: names and "your" emails are per person, not per family.
	const me = await currentGuardian(family.id, Astro.locals.sessionEmail || family.email);
	const myName = me?.name || family.name;
	const actionResult = await runActions(Astro, {
		add: async (form) => {
			const result = await startAddEmail(family.id, String(form.get('email') ?? ''));
			if (result.ok && me) await claimEmail(family.id, me.id, result.email);
			if (!result.ok && result.otherFamily) {
				const invited = await inviteToFamily(family.id, String(form.get('email') ?? ''));
				return { redirect: back(invited.ok ? { notice: 'That email has its own family account. We sent it an invitation to join your family.' } : { error: invited.error }) };
			}
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
		name: async (form) => accountResult(me ? await renameGuardian(family.id, me.id, String(form.get('name') ?? '')) : await renameFamily(family.id, String(form.get('name') ?? '')), 'Your name is saved.', { dialog: 'name' }),
		'family-name': async (form) => {
			await saveHouseholdName(family.id, String(form.get('name') ?? ''));
			return { redirect: back({ notice: 'Family name saved.' }) };
		},
		'add-guardian': async (form) => {
			const result = await addGuardian({ familyId: family.id, name: String(form.get('name') ?? ''), email: String(form.get('email') ?? ''), by: myName });
			if (!result.ok) return { redirect: back({ dialog: 'add-guardian', error: result.error }) };
			return { redirect: back({ notice: result.invited === 'merge' ? 'That email has its own family account. We sent it an invitation to join yours.' : 'Guardian added. We emailed them a link to set a password.' }) };
		},
		'remove-guardian': async (form) => {
			const result = me ? await removeGuardian({ familyId: family.id, actorId: me.id, personId: String(form.get('id') ?? ''), by: myName }) : { ok: false as const, error: 'Sign in again to manage guardians.' };
			return { redirect: back(result.ok ? { notice: 'Guardian removed.' } : { error: result.error }) };
		},
		join: async (form) => {
			const result = await requestToJoin(family.id, String(form.get('email') ?? ''));
			return { redirect: result.ok ? back({ notice: 'If that email has a family account, we sent them your request.' }) + '#family' : back({ dialog: 'join', error: result.error }) };
		},
		'join-answer': async (form) => {
			const result = await answerJoinRequest({ id: String(form.get('id') ?? ''), familyId: family.id, approve: form.get('answer') === 'approve', by: Astro.locals.sessionEmail || family.email });
			return { redirect: back(result.ok ? { notice: form.get('answer') === 'approve' ? 'Families combined.' : 'Request declined.' } : { error: result.error }) + '#family' };
		},
		'join-cancel': async (form) => {
			await cancelJoinRequest(String(form.get('id') ?? ''), family.id, Astro.locals.sessionEmail || family.email);
			return { redirect: back({ notice: 'Request cancelled.' }) + '#family' };
		},
		// One kind of message at a time: the default (every guardian) or chosen emails.
		notify: async (form) => {
			const category = String(form.get('category') ?? '') as 'announcements' | 'tours' | 'admin';
			const result = await saveNotifications(family.id, category, form.get('mode') === 'default' ? null : form.getAll('emails').map(String));
			return { redirect: back(result.ok ? { notice: 'Notifications saved.' } : { dialog: 'notify', category, error: result.error }) };
		},
	}, {
		actionFrom: (form) => { const actions = form.getAll('action').map(String); return actions.includes('resend') ? 'resend' : actions[0] || ''; },
		csrfFailure: (error) => ({ redirect: back({ error }) }),
		fallback: async () => ({ redirect: back({ notice: '' }) }),
	});
	if ('redirect' in actionResult) return Astro.redirect(actionResult.redirect, actionResult.status);
	const [allEmails, routes, requests, guardians, householdName] = await Promise.all([listSignInEmails(family.id), notificationChoices(family.id), listJoinRequests(family.id), listGuardians(family.id), readHouseholdName(family.id)]);
	const you = guardians.find((person) => person.id === me?.id) ?? null;
	// Your sign-in shows only your own emails; other guardians manage theirs.
	const emails = you ? allEmails.filter((item) => you.emails.some((own) => own.id === item.id)) : allEmails;
	const familyName = householdName || (family.lastName ? `The ${family.lastName} family` : '');
	const removing = guardians.find((person) => person.id === Astro.url.searchParams.get('id'));
	const incoming = requests.filter((request) => answeringFamily(request) === family.id);
	const outgoing = requests.filter((request) => answeringFamily(request) !== family.id);
	const dialog = Astro.url.searchParams.get('dialog') || '';
	const focusId = Astro.url.searchParams.get('id') || '';
	const verifyAddress = Astro.url.searchParams.get('email') || '';
	const error = Astro.url.searchParams.get('error') || '';
	const notice = toastFrom(Astro.url, { notice: value => value });
	const focus = emails.find((item) => item.id === focusId);
	const losesAdmin = dialog === 'remove' && focus ? await adminLossOnRemove(family.id, focus.id) : false;
	const verified = allEmails.filter((item) => item.verified);
	const adminChoices = verified.filter((item) => emailOpensAdmin(item.email));
	const showAdminRoute = family.roles.includes('admin') && adminChoices.length > 0;
	const fresh = family;
	const changed = fresh?.passwordChangedAt ? formatChicago(fresh.passwordChangedAt, false) : '';
	const notifyCategory = Astro.url.searchParams.get('category') || '';
	const emailOwner = new Map(guardians.flatMap((person) => person.emails.map((item) => [item.email, person.name] as const)));
	return { notifyCategory, emailOwner, csrf, back, emails, guardians, you, myName, householdName, familyName, removing, routes, incoming, outgoing, dialog, verifyAddress, error, notice, focus, losesAdmin, verified, adminChoices, showAdminRoute, fresh, changed };
}

export type AccountView = Exclude<Awaited<ReturnType<typeof loadAccount>>, Response>;
