import { randomUUID } from 'node:crypto';
import { sendTemplate } from './email-catalog.ts';
import { db, dbReady } from './db.ts';
import { issueToken } from './data.ts';
import { portalOrigin, sendEmail } from './email.ts';
import { inviteToFamily, logFamilyActivity, mergeFamilies } from './family-merge.ts';
import type { Result } from './result.ts';

/**
 * Guardians are people in a family; each sign-in email belongs to one of them.
 * The account holder is whoever owns the family's primary email, and their name
 * stays mirrored on families.name (used across Admin). The household's own name
 * is families.household_name.
 */

export type Guardian = {
	id: string;
	name: string;
	holder: boolean;
	emails: { id: string; email: string; primary: boolean; verified: boolean }[];
};

const validAddress = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

/**
 * Make sure every email has a person. Older families have none: the account
 * holder takes the unlabeled emails; a labeled email (added by staff as
 * "another guardian") becomes its own person named by its label.
 */
export async function ensurePeople(familyId: string): Promise<void> {
	await dbReady();
	const loose = await db()`select id, email, is_primary, label from family_emails where family_id = ${familyId} and person_id is null and child_id is null order by is_primary desc, created_at`;
	if (!loose.length) return;
	const [family] = await db()`select name, email from families where id = ${familyId}`;
	if (!family) return;
	const holder = await db()`
		select p.id from family_people p join family_emails e on e.person_id = p.id
		where p.family_id = ${familyId} and e.is_primary limit 1`;
	let holderId = holder[0] ? String(holder[0].id) : '';
	const ensureHolder = async () => {
		if (!holderId) {
			holderId = randomUUID();
			await db()`insert into family_people (id, family_id, name) values (${holderId}, ${familyId}, ${String(family.name || '')})`;
		}
		return holderId;
	};
	for (const row of loose) {
		const label = String(row.label || '').trim();
		if (!row.is_primary && label) {
			const id = randomUUID();
			await db()`insert into family_people (id, family_id, name) values (${id}, ${familyId}, ${label})`;
			await db()`update family_emails set person_id = ${id} where id = ${row.id}`;
		} else {
			await db()`update family_emails set person_id = ${await ensureHolder()} where id = ${row.id}`;
		}
	}
	// A family whose people were all removed by hand still needs someone.
	await db()`delete from family_people p where p.family_id = ${familyId} and not exists (select 1 from family_emails e where e.person_id = p.id)`;
}

export async function listGuardians(familyId: string): Promise<Guardian[]> {
	await ensurePeople(familyId);
	const rows = await db()`
		select p.id, p.name, p.created_at, e.id as email_id, e.email, e.is_primary, e.verified_at
		from family_people p join family_emails e on e.person_id = p.id
		where p.family_id = ${familyId}
		order by p.created_at, e.is_primary desc, e.created_at`;
	const people = new Map<string, Guardian>();
	for (const row of rows) {
		const id = String(row.id);
		const person = people.get(id) ?? { id, name: String(row.name || ''), holder: false, emails: [] };
		person.emails.push({ id: String(row.email_id), email: String(row.email), primary: !!row.is_primary, verified: !!row.verified_at });
		if (row.is_primary) person.holder = true;
		people.set(id, person);
	}
	return [...people.values()].sort((a, b) => Number(b.holder) - Number(a.holder));
}

/** The person signed in with `email`, or the account holder for older sessions. */
export async function currentGuardian(familyId: string, email: string): Promise<Guardian | null> {
	return pickGuardian(await listGuardians(familyId), email);
}

/** The same choice as currentGuardian, from a list the caller already loaded. */
export function pickGuardian(guardians: Guardian[], email: string): Guardian | null {
	return guardians.find((person) => person.emails.some((item) => item.email === email.toLowerCase())) ?? guardians.find((person) => person.holder) ?? guardians[0] ?? null;
}

/** An email the person just added to their own sign-in. */
export async function claimEmail(familyId: string, personId: string, email: string): Promise<void> {
	await dbReady();
	await db()`update family_emails set person_id = ${personId} where family_id = ${familyId} and email = ${email.trim().toLowerCase()} and person_id is null`;
}

export async function renameGuardian(familyId: string, personId: string, nameInput: string): Promise<Result> {
	await dbReady();
	const name = nameInput.trim().replace(/\s+/g, ' ');
	if (name.length < 2) return { ok: false, error: 'Enter a name.' };
	const rows = await db()`update family_people set name = ${name} where id = ${personId} and family_id = ${familyId} returning id`;
	if (!rows[0]) return { ok: false, error: 'That person is not in this family.' };
	const holder = await db()`select 1 from family_emails where person_id = ${personId} and is_primary`;
	if (holder[0]) {
		const [first, ...rest] = name.split(' ');
		await db()`update families set name = ${name}, first_name = ${first}, last_name = ${rest.join(' ')} where id = ${familyId}`;
	}
	return { ok: true };
}

/**
 * Add another guardian by email. An email new to the portal joins this family
 * and gets a link to set a password (which also verifies it). An email that
 * already has its own family gets an invitation to merge instead.
 */
export async function addGuardian(input: { familyId: string; name: string; email: string; by: string }): Promise<Result<{ invited: 'new' | 'merge' }>> {
	await dbReady();
	const name = input.name.trim().replace(/\s+/g, ' ');
	const email = input.email.trim().toLowerCase();
	if (name.length < 2) return { ok: false, error: 'Enter their name.' };
	if (!validAddress(email)) return { ok: false, error: 'Enter an email address like name@example.com.' };
	const [taken] = await db()`select family_id from family_emails where email = ${email}`;
	const [legacy] = taken ? [] : await db()`select id from families where lower(email) = ${email} and merged_into_id is null`;
	const owner = taken ? String(taken.family_id) : legacy ? String(legacy.id) : '';
	if (owner === input.familyId) return { ok: false, error: 'That email is already in your family.' };
	if (owner) {
		const invited = await inviteToFamily(input.familyId, email);
		return invited.ok ? { ok: true, invited: 'merge' } : invited;
	}
	const personId = randomUUID();
	await db()`insert into family_people (id, family_id, name) values (${personId}, ${input.familyId}, ${name})`;
	await db()`insert into family_emails (id, family_id, email, is_primary, label, person_id) values (${randomUUID()}, ${input.familyId}, ${email}, false, ${name}, ${personId})`;
	const [family] = await db()`select coalesce(nullif(household_name, ''), name) as name from families where id = ${input.familyId}`;
	const token = await issueToken(input.familyId, 'reset', 24 * 7, email);
	await sendTemplate('account.guardian-added', email, { name, by: input.by, family: String(family?.name || 'family'), link: `${portalOrigin()}/reset?token=${encodeURIComponent(token)}` });
	await logFamilyActivity(input.familyId, 'joined', input.by, `Added ${name} (${email}) as a guardian`);
	return { ok: true, invited: 'new' };
}

/** Remove another guardian and their sign-in emails. Nobody can remove themselves. */
export async function removeGuardian(input: { familyId: string; actorId: string; personId: string; by: string }): Promise<Result> {
	await dbReady();
	if (input.actorId === input.personId) return { ok: false, error: 'You can’t remove yourself.' };
	const guardians = await listGuardians(input.familyId);
	const target = guardians.find((person) => person.id === input.personId);
	const actor = guardians.find((person) => person.id === input.actorId);
	if (!target || !actor) return { ok: false, error: 'That person is not in this family.' };
	const actorEmail = actor.emails.find((item) => item.primary) ?? actor.emails.find((item) => item.verified) ?? actor.emails[0];
	if (!actorEmail) return { ok: false, error: 'Add a verified email for yourself first.' };
	await db().begin(async (tx) => {
		if (target.holder) {
			// The family's primary email moves to the person removing them.
			await tx`update family_emails set is_primary = false where family_id = ${input.familyId}`;
			await tx`update family_emails set is_primary = true where id = ${actorEmail.id}`;
			await tx`update families set email = ${actorEmail.email}, name = ${actor.name || actorEmail.email} where id = ${input.familyId}`;
		}
		for (const item of target.emails) {
			await tx`delete from notification_routes where family_id = ${input.familyId} and email = ${item.email}`;
			await tx`delete from email_codes where family_id = ${input.familyId} and email = ${item.email}`;
			await tx`delete from family_emails where id = ${item.id}`;
		}
		await tx`delete from family_people where id = ${target.id}`;
	});
	await logFamilyActivity(input.familyId, 'joined', input.by, `Removed ${target.name || target.emails[0]?.email} as a guardian`);
	return { ok: true };
}

/**
 * One person with two accounts (say a school email and a personal one): fold the
 * person signed in as `dropEmail` into the person signed in as `keepEmail`. All of
 * their sign-in emails then open one account and share one set of access.
 *
 * When the two are in different households, the leaving person's household folds
 * into the staying one first (children, tours, forms and all), but only when the
 * leaving person is its only guardian. A shared household is merged from Families.
 */
export async function mergePeople(input: { keepEmail: string; dropEmail: string; by: string }): Promise<Result<{ familyId: string }>> {
	await dbReady();
	const keepEmail = input.keepEmail.trim().toLowerCase(), dropEmail = input.dropEmail.trim().toLowerCase();
	if (keepEmail === dropEmail) return { ok: false, error: 'Choose two different people.' };
	const locate = async (email: string) => {
		const [row] = await db()`
			select e.family_id, e.person_id, e.child_id, f.merged_into_id from family_emails e join families f on f.id = e.family_id where e.email = ${email}`;
		return row ? { familyId: String(row.family_id), personId: row.person_id ? String(row.person_id) : '', student: !!row.child_id, merged: !!row.merged_into_id } : null;
	};
	const before = [await locate(keepEmail), await locate(dropEmail)];
	if (!before[0] || !before[1]) return { ok: false, error: 'One of those people no longer has a sign-in.' };
	if (before[0].student || before[1].student) return { ok: false, error: 'A student’s own sign-in can’t be merged.' };
	if (before[0].merged || before[1].merged) return { ok: false, error: 'One of those households was already merged. Reload and try again.' };
	await ensurePeople(before[0].familyId);
	if (before[1].familyId !== before[0].familyId) await ensurePeople(before[1].familyId);
	const keep = (await locate(keepEmail))!, drop = (await locate(dropEmail))!;
	if (!keep.personId || !drop.personId) return { ok: false, error: 'Those sign-ins aren’t set up as people yet. Reload and try again.' };
	if (keep.personId === drop.personId) return { ok: false, error: 'Those emails already belong to the same person.' };
	const [dropPerson] = await db()`select name from family_people where id = ${drop.personId}`;
	const dropName = String(dropPerson?.name || '') || dropEmail;
	if (drop.familyId !== keep.familyId) {
		const [others] = await db()`select count(*)::int as n from family_people where family_id = ${drop.familyId} and id <> ${drop.personId}`;
		if (others.n > 0) return { ok: false, error: `${dropName} shares a household with other guardians. Merge the two households from Families first, then merge these people.` };
		const folded = await mergeFamilies({ fromFamilyId: drop.familyId, toFamilyId: keep.familyId, by: input.by, staff: true });
		if (!folded.ok) return folded;
	}
	await db().begin(async (tx) => {
		await tx`update family_emails set person_id = ${keep.personId} where person_id = ${drop.personId}`;
		// One person, one set of access: every email gets the union.
		await tx`
			update family_emails set roles = (select array(select distinct r from family_emails o, unnest(o.roles) r where o.person_id = ${keep.personId}))
			where person_id = ${keep.personId}`;
		await tx`update family_people set name = ${dropName} where id = ${keep.personId} and name = '' and ${String(dropPerson?.name || '')} <> ''`;
		await tx`delete from family_people where id = ${drop.personId}`;
	});
	// The account holder's name is mirrored on the family; the holder may now be this person.
	const [holder] = await db()`select p.name from family_people p join family_emails e on e.person_id = p.id where p.family_id = ${keep.familyId} and e.is_primary and p.name <> ''`;
	if (holder) {
		const name = String(holder.name), [first, ...rest] = name.split(' ');
		await db()`update families set name = ${name}, first_name = ${first}, last_name = ${rest.join(' ')} where id = ${keep.familyId}`;
	}
	await logFamilyActivity(keep.familyId, 'merged', input.by, `${dropName} (${dropEmail}) merged into ${keepEmail}`);
	return { ok: true, familyId: keep.familyId };
}
