import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { db, dbReady } from './db.ts';
import { sendEmail } from './email.ts';
import { hashPassword, verifyPassword } from './passwords.ts';

export const SCHOOL_DOMAIN = 'trinityclassical.academy';
export const NOTIFICATION_CATEGORIES = ['announcements', 'tours', 'admin'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export type SignInEmail = {
	id: string;
	email: string;
	primary: boolean;
	verified: boolean;
	school: boolean;
	password: boolean;
	google: boolean;
};

const CODE_TRIES = 5;

function allowList(): string[] {
	return (process.env.PORTAL_ADMIN_EMAILS || '')
		.split(',')
		.map((email) => email.trim().toLowerCase())
		.filter(Boolean);
}

export function isSchoolEmail(email: string): boolean {
	return email.trim().toLowerCase().endsWith(`@${SCHOOL_DOMAIN}`);
}

/** Admin opens only for a school address or an address on PORTAL_ADMIN_EMAILS. */
export function emailOpensAdmin(email: string): boolean {
	const value = email.trim().toLowerCase();
	return Boolean(value) && (isSchoolEmail(value) || allowList().includes(value));
}

function hashCode(code: string): string {
	return createHash('sha256').update(code).digest('hex');
}

function codesMatch(provided: string, expected: string): boolean {
	const left = Buffer.from(provided);
	const right = Buffer.from(expected);
	if (left.length !== right.length) return false;
	return timingSafeEqual(left, right);
}

function mapEmail(row: Record<string, unknown>): SignInEmail {
	const email = String(row.email);
	return {
		id: String(row.id),
		email,
		primary: Boolean(row.is_primary),
		verified: Boolean(row.verified_at),
		school: isSchoolEmail(email),
		password: Boolean(row.password_hash),
		google: Boolean(row.google_sub),
	};
}

export async function mirrorPrimary(familyId: string): Promise<void> {
	const rows = await db()`
		select email, password_hash, email_verified_at, google_sub
		from families where id = ${familyId}
	`;
	if (!rows[0] || !String(rows[0].email || '').trim()) return;
	const existing = await db()`select id from family_emails where family_id = ${familyId} limit 1`;
	if (existing[0]) return;
	const email = String(rows[0].email).trim().toLowerCase();
	const hash = rows[0].password_hash ? String(rows[0].password_hash) : null;
	await db()`
		insert into family_emails (id, family_id, email, is_primary, verified_at, password_hash, google_sub)
		values (${randomUUID()}, ${familyId}, ${email}, true, ${rows[0].email_verified_at}, ${hash}, ${rows[0].google_sub})
	`;
	await seedRoutes(familyId, email);
}

async function seedRoutes(familyId: string, email: string): Promise<void> {
	for (const category of NOTIFICATION_CATEGORIES) {
		await db()`
			insert into notification_routes (family_id, category, email)
			values (${familyId}, ${category}, ${email})
			on conflict (family_id, category) do nothing
		`;
	}
}

export async function touchSignIn(familyId: string): Promise<void> {
	await db()`update families set last_sign_in_at = now() where id = ${familyId}`;
}

export async function listSignInEmails(familyId: string): Promise<SignInEmail[]> {
	await dbReady();
	await mirrorPrimary(familyId);
	const rows = await db()`
		select id, email, is_primary, verified_at, password_hash, google_sub
		from family_emails
		where family_id = ${familyId}
		order by is_primary desc, created_at
	`;
	return rows.map((row) => mapEmail(row));
}

export async function routeEmail(familyId: string, category: NotificationCategory, fallback: string): Promise<string> {
	await dbReady();
	const rows = await db()`
		select email from notification_routes where family_id = ${familyId} and category = ${category}
	`;
	return rows[0] ? String(rows[0].email) : fallback;
}

export async function notificationChoices(familyId: string): Promise<Record<NotificationCategory, string>> {
	await dbReady();
	await mirrorPrimary(familyId);
	const rows = await db()`select category, email from notification_routes where family_id = ${familyId}`;
	const found = Object.fromEntries(rows.map((row) => [String(row.category), String(row.email)]));
	const primary = (await listSignInEmails(familyId)).find((item) => item.primary)?.email ?? '';
	return {
		announcements: found.announcements || primary,
		tours: found.tours || primary,
		admin: found.admin || primary,
	};
}

async function primaryEmail(familyId: string): Promise<SignInEmail | null> {
	const emails = await listSignInEmails(familyId);
	return emails.find((item) => item.primary) ?? emails[0] ?? null;
}

async function syncPrimary(familyId: string): Promise<void> {
	const row = await db()`
		select email, password_hash, google_sub, verified_at
		from family_emails where family_id = ${familyId} and is_primary
		limit 1
	`;
	if (!row[0]) return;
	await db()`
		update families
		set email = ${String(row[0].email)},
			password_hash = ${row[0].password_hash ? String(row[0].password_hash) : ''},
			google_sub = ${row[0].google_sub ? String(row[0].google_sub) : null},
			email_verified_at = ${row[0].verified_at}
		where id = ${familyId}
	`;
}

function validAddress(email: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sendCode(familyId: string, email: string): Promise<string> {
	const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
	await db()`delete from email_codes where family_id = ${familyId} and email = ${email} and used_at is null`;
	await db()`
		insert into email_codes (id, family_id, email, code_hash, expires_at)
		values (${randomUUID()}, ${familyId}, ${email}, ${hashCode(code)}, now() + interval '10 minutes')
	`;
	await sendEmail({
		to: email,
		subject: 'Your TCA Portal code',
		text: `Your TCA Portal code is ${code}. It expires in 10 minutes.`,
	});
	return code;
}

export async function startAddEmail(familyId: string, emailInput: string): Promise<{ ok: true; email: string; code: string } | { ok: false; error: string }> {
	await dbReady();
	const email = emailInput.trim().toLowerCase();
	if (!validAddress(email)) return { ok: false, error: 'Enter an email address like name@example.com.' };
	const taken = await db()`select family_id, verified_at from family_emails where email = ${email}`;
	if (taken[0] && String(taken[0].family_id) !== familyId) {
		return { ok: false, error: 'This email belongs to another profile. If both profiles are yours, contact the office to merge them.' };
	}
	if (taken[0]?.verified_at) return { ok: false, error: 'That email is already on this profile.' };
	if (!taken[0]) {
		await db()`
			insert into family_emails (id, family_id, email, is_primary)
			values (${randomUUID()}, ${familyId}, ${email}, false)
		`;
	}
	const code = await sendCode(familyId, email);
	return { ok: true, email, code };
}

export async function resendEmailCode(familyId: string, emailInput: string): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
	await dbReady();
	const email = emailInput.trim().toLowerCase();
	const rows = await db()`select id, verified_at from family_emails where family_id = ${familyId} and email = ${email}`;
	if (!rows[0]) return { ok: false, error: 'That email is not on this profile.' };
	if (rows[0].verified_at) return { ok: false, error: 'That email is already verified.' };
	return { ok: true, code: await sendCode(familyId, email) };
}

export async function verifyEmailCode(familyId: string, emailInput: string, codeInput: string): Promise<{ ok: true } | { ok: false; error: string; left?: number }> {
	await dbReady();
	const email = emailInput.trim().toLowerCase();
	const code = codeInput.replace(/\s/g, '');
	const rows = await db()`
		select id, code_hash, attempts from email_codes
		where family_id = ${familyId} and email = ${email} and used_at is null and expires_at > now()
		order by expires_at desc
		limit 1
	`;
	if (!rows[0]) return { ok: false, error: 'That code has expired. Request a new one.' };
	const attempts = Number(rows[0].attempts);
	if (attempts >= CODE_TRIES) return { ok: false, error: 'That code doesn’t match. Request a new one.' };
	if (!codesMatch(hashCode(code), String(rows[0].code_hash))) {
		const next = attempts + 1;
		await db()`update email_codes set attempts = ${next} where id = ${rows[0].id}`;
		const left = CODE_TRIES - next;
		return { ok: false, error: left > 0 ? `That code doesn’t match. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'That code doesn’t match. Request a new one.', left };
	}
	await db()`update email_codes set used_at = now() where id = ${rows[0].id}`;
	await db()`update family_emails set verified_at = coalesce(verified_at, now()) where family_id = ${familyId} and email = ${email}`;
	if (allowList().includes(email)) {
		const current = await db()`select roles from families where id = ${familyId}`;
		const roles = Array.from(new Set([...(Array.isArray(current[0]?.roles) ? current[0].roles.map(String) : []), 'prospect', 'admin']));
		await db()`update families set roles = ${roles} where id = ${familyId}`;
	}
	return { ok: true };
}

export async function makePrimary(familyId: string, emailId: string): Promise<{ ok: true } | { ok: false; error: string }> {
	await dbReady();
	const rows = await db()`select id, verified_at from family_emails where id = ${emailId} and family_id = ${familyId}`;
	if (!rows[0]) return { ok: false, error: 'That email is not on this profile.' };
	if (!rows[0].verified_at) return { ok: false, error: 'Verify this email before making it primary.' };
	await db()`update family_emails set is_primary = false where family_id = ${familyId}`;
	await db()`update family_emails set is_primary = true where id = ${emailId}`;
	await syncPrimary(familyId);
	return { ok: true };
}

export async function adminLossOnRemove(familyId: string, emailId: string): Promise<boolean> {
	const emails = await listSignInEmails(familyId);
	const target = emails.find((item) => item.id === emailId);
	if (!target) return false;
	const family = await db()`select roles from families where id = ${familyId}`;
	const roles = Array.isArray(family[0]?.roles) ? family[0].roles.map(String) : [];
	if (!roles.includes('admin')) return false;
	if (!emailOpensAdmin(target.email)) return false;
	return !emails.some((item) => item.id !== emailId && item.verified && emailOpensAdmin(item.email));
}

export async function removeSignInEmail(familyId: string, emailId: string, confirm: string): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
	await dbReady();
	const emails = await listSignInEmails(familyId);
	const target = emails.find((item) => item.id === emailId);
	if (!target) return { ok: false, error: 'That email is not on this profile.' };
	if (target.primary) return { ok: false, error: 'Your primary email can’t be removed.' };
	const losesAdmin = await adminLossOnRemove(familyId, emailId);
	if (losesAdmin && confirm !== 'anyway') return { ok: false, error: 'Removing this school email turns off Admin access.' };
	const primary = emails.find((item) => item.primary);
	if (primary) {
		await db()`
			update notification_routes set email = ${primary.email}
			where family_id = ${familyId} and email = ${target.email}
		`;
	}
	await db()`delete from email_codes where family_id = ${familyId} and email = ${target.email}`;
	await db()`delete from family_emails where id = ${emailId} and family_id = ${familyId}`;
	if (losesAdmin) {
		const current = await db()`select roles from families where id = ${familyId}`;
		const roles = (Array.isArray(current[0]?.roles) ? current[0].roles.map(String) : []).filter((role) => role !== 'admin');
		await db()`update families set roles = ${roles.length ? roles : ['prospect']} where id = ${familyId}`;
	}
	return { ok: true, email: target.email };
}

export async function saveNotifications(familyId: string, choices: Partial<Record<NotificationCategory, string>>): Promise<{ ok: true } | { ok: false; error: string }> {
	await dbReady();
	const emails = await listSignInEmails(familyId);
	const verified = new Set(emails.filter((item) => item.verified).map((item) => item.email));
	for (const category of NOTIFICATION_CATEGORIES) {
		const email = choices[category]?.trim().toLowerCase();
		if (!email) continue;
		if (!verified.has(email)) return { ok: false, error: 'Choose a verified email.' };
		if (category === 'admin' && !emailOpensAdmin(email)) return { ok: false, error: 'Admin alerts go to a school email.' };
		await db()`
			insert into notification_routes (family_id, category, email)
			values (${familyId}, ${category}, ${email})
			on conflict (family_id, category) do update set email = ${email}
		`;
	}
	return { ok: true };
}

export async function unlinkGoogle(familyId: string, emailId: string): Promise<{ ok: true } | { ok: false; error: string }> {
	await dbReady();
	const rows = await db()`select email, password_hash, google_sub from family_emails where id = ${emailId} and family_id = ${familyId}`;
	if (!rows[0]?.google_sub) return { ok: false, error: 'Google is not linked to that email.' };
	if (!rows[0].password_hash) {
		return { ok: false, error: `Google is the only way to sign in with ${rows[0].email}. Turn on password sign-in for it, then unlink Google.` };
	}
	await db()`update family_emails set google_sub = null where id = ${emailId}`;
	await syncPrimary(familyId);
	return { ok: true };
}

export async function linkGoogleAccount(input: { familyId: string; emailId: string; sub: string; email: string }): Promise<{ ok: true } | { ok: false; error: string }> {
	await dbReady();
	const email = input.email.trim().toLowerCase();
	const rows = await db()`select email from family_emails where id = ${input.emailId} and family_id = ${input.familyId}`;
	if (!rows[0]) return { ok: false, error: 'That email is not on this profile.' };
	if (String(rows[0].email) !== email) return { ok: false, error: `Sign in to Google as ${rows[0].email} to link it.` };
	const used = await db()`select family_id from family_emails where google_sub = ${input.sub} and id <> ${input.emailId}`;
	if (used[0]) return { ok: false, error: 'That Google account is already used on another profile.' };
	await db()`
		update family_emails
		set google_sub = ${input.sub}, verified_at = coalesce(verified_at, now())
		where id = ${input.emailId}
	`;
	await syncPrimary(input.familyId);
	return { ok: true };
}

export async function setEmailPassword(familyId: string, emailId: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
	await dbReady();
	if (password.length < 10) return { ok: false, error: 'Use at least 10 characters.' };
	const rows = await db()`select id from family_emails where id = ${emailId} and family_id = ${familyId}`;
	if (!rows[0]) return { ok: false, error: 'That email is not on this profile.' };
	const passwordHash = await hashPassword(password);
	await db()`update family_emails set password_hash = ${passwordHash} where id = ${emailId}`;
	await db()`update families set password_changed_at = now() where id = ${familyId}`;
	await syncPrimary(familyId);
	return { ok: true };
}

export async function clearEmailPassword(familyId: string, emailId: string): Promise<{ ok: true } | { ok: false; error: string }> {
	await dbReady();
	const rows = await db()`select google_sub from family_emails where id = ${emailId} and family_id = ${familyId}`;
	if (!rows[0]) return { ok: false, error: 'That email is not on this profile.' };
	if (!rows[0].google_sub) return { ok: false, error: 'Link Google before turning the password off. An email needs one way to sign in.' };
	await db()`update family_emails set password_hash = null where id = ${emailId}`;
	await syncPrimary(familyId);
	return { ok: true };
}

export async function changePassword(familyId: string, current: string, next: string): Promise<{ ok: true } | { ok: false; error: string }> {
	await dbReady();
	if (next.length < 10) return { ok: false, error: 'Use at least 10 characters.' };
	const rows = await db()`select id, password_hash from family_emails where family_id = ${familyId} and password_hash is not null`;
	const family = await db()`select password_hash from families where id = ${familyId}`;
	const hashes = rows.map((row) => String(row.password_hash));
	if (family[0]?.password_hash) hashes.push(String(family[0].password_hash));
	let matches = false;
	for (const stored of hashes) {
		if (await verifyPassword(current, stored)) matches = true;
	}
	if (!matches) return { ok: false, error: 'The current password does not match.' };
	const passwordHash = await hashPassword(next);
	await db()`update family_emails set password_hash = ${passwordHash} where family_id = ${familyId} and password_hash is not null`;
	await db()`update families set password_hash = ${passwordHash}, password_changed_at = now() where id = ${familyId}`;
	const verified = await db()`select email from family_emails where family_id = ${familyId} and verified_at is not null`;
	for (const row of verified) {
		await sendEmail({
			to: String(row.email),
			subject: 'Your TCA Portal password changed',
			text: 'The password for your TCA Portal profile just changed. If this was not you, contact the school office.',
		});
	}
	return { ok: true };
}

export async function renameFamily(familyId: string, nameInput: string): Promise<{ ok: true } | { ok: false; error: string }> {
	await dbReady();
	const name = nameInput.trim().replace(/\s+/g, ' ');
	if (name.length < 2) return { ok: false, error: 'Enter your name.' };
	const [firstName, ...rest] = name.split(' ');
	await db()`
		update families
		set name = ${name}, first_name = ${firstName}, last_name = ${rest.join(' ')}
		where id = ${familyId}
	`;
	return { ok: true };
}

export async function removeStaffAccess(actorId: string, targetId: string): Promise<{ ok: true } | { ok: false; error: string }> {
	await dbReady();
	if (actorId === targetId) return { ok: false, error: 'You can’t remove your own Admin access.' };
	const rows = await db()`select roles, name, email from families where id = ${targetId}`;
	if (!rows[0]) return { ok: false, error: 'That person is not on the staff list.' };
	const roles = (Array.isArray(rows[0].roles) ? rows[0].roles.map(String) : []).filter((role) => role !== 'admin');
	await db()`update families set roles = ${roles.length ? roles : ['prospect']} where id = ${targetId}`;
	return { ok: true };
}

export async function signInGoogleAccount(profile: { sub: string; email: string; givenName: string; familyName: string }): Promise<{ id: string; sessionEmail: string }> {
	await dbReady();
	const email = profile.email.trim().toLowerCase();
	const named = `${profile.givenName} ${profile.familyName}`.trim() || email;
	const subRow = await db()`select family_id, email from family_emails where google_sub = ${profile.sub} limit 1`;
	if (subRow[0]) {
		const familyId = String(subRow[0].family_id);
		await fillName(familyId, profile.givenName, profile.familyName, named);
		await grantAllowList(familyId, String(subRow[0].email));
		await touchSignIn(familyId);
		return { id: familyId, sessionEmail: String(subRow[0].email) };
	}
	const emailRow = await db()`select id, family_id from family_emails where email = ${email} limit 1`;
	if (emailRow[0]) {
		const familyId = String(emailRow[0].family_id);
		await db()`
			update family_emails
			set google_sub = ${profile.sub}, verified_at = coalesce(verified_at, now())
			where id = ${emailRow[0].id}
		`;
		await fillName(familyId, profile.givenName, profile.familyName, named);
		await grantAllowList(familyId, email);
		await syncPrimary(familyId);
		await touchSignIn(familyId);
		await db()`insert into activity (kind, summary) values ('family', ${`${email} signed in with Google`})`;
		return { id: familyId, sessionEmail: email };
	}
	const legacy = await db()`select id from families where lower(email) = ${email} or google_sub = ${profile.sub} limit 1`;
	if (legacy[0]) {
		const familyId = String(legacy[0].id);
		await mirrorPrimary(familyId);
		await db()`
			update family_emails
			set google_sub = ${profile.sub}, verified_at = coalesce(verified_at, now())
			where family_id = ${familyId} and email = ${email}
		`;
		await fillName(familyId, profile.givenName, profile.familyName, named);
		await grantAllowList(familyId, email);
		await syncPrimary(familyId);
		await touchSignIn(familyId);
		return { id: familyId, sessionEmail: email };
	}
	const id = randomUUID();
	const roles = allowList().includes(email) ? ['prospect', 'admin'] : ['prospect'];
	await db()`
		insert into families (id, name, first_name, last_name, email, phone, password_hash, roles, google_sub, email_verified_at)
		values (${id}, ${named}, ${profile.givenName}, ${profile.familyName}, ${email}, ${''}, ${''}, ${roles}, ${profile.sub}, now())
	`;
	await db()`
		insert into family_emails (id, family_id, email, is_primary, verified_at, google_sub)
		values (${randomUUID()}, ${id}, ${email}, true, now(), ${profile.sub})
	`;
	await seedRoutes(id, email);
	await touchSignIn(id);
	await db()`insert into activity (kind, summary) values ('family', ${`${email} signed in with Google`})`;
	return { id, sessionEmail: email };
}

async function fillName(familyId: string, givenName: string, familyName: string, named: string): Promise<void> {
	await db()`
		update families
		set first_name = case when first_name = '' then ${givenName} else first_name end,
			last_name = case when last_name = '' then ${familyName} else last_name end,
			name = case when name = '' then ${named} else name end
		where id = ${familyId}
	`;
}

async function grantAllowList(familyId: string, email: string): Promise<void> {
	if (!allowList().includes(email)) return;
	const current = await db()`select roles from families where id = ${familyId}`;
	const roles = Array.from(new Set([...(Array.isArray(current[0]?.roles) ? current[0].roles.map(String) : []), 'prospect', 'admin']));
	await db()`update families set roles = ${roles} where id = ${familyId}`;
}
