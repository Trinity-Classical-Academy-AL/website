import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

process.env.ADMISSIONS_STORE = 'file';
process.env.FAMILY_SESSION_SECRET ||= 'ci-family-secret';

const { db, dbReady, hashPassword, issueFamilySession, saveSchoolDocument, saveSchoolForm, addTourSlot } = await import('@tca/school');
await dbReady();

const stamp = Date.now();
const password = 'correct-horse-battery';
const hash = await hashPassword(password);
const ada = { id: randomUUID(), email: `ada-${stamp}@example.com`, name: 'Ada Brook' };
const bea = { id: randomUUID(), email: `bea-${stamp}@example.com`, name: 'Bea Cole' };
const pat = { id: randomUUID(), email: `pat-${stamp}@example.com`, name: 'Pat Lee' };
const office = { id: randomUUID(), email: `office-${stamp}@trinityclassical.academy`, name: 'Office' };

async function family(row, roles, passwordHash = '') {
	await db()`insert into families (id, name, email, phone, password_hash, roles) values (${row.id}, ${row.name}, ${row.email}, ${''}, ${passwordHash}, ${roles})`;
	await db()`insert into family_emails (id, family_id, email, is_primary, verified_at, password_hash) values (${randomUUID()}, ${row.id}, ${row.email}, ${true}, ${new Date().toISOString()}, ${passwordHash || null})`;
}

await family(ada, ['guardian']);
await family(bea, ['guardian']);
await family(pat, ['prospect'], hash);
await family(office, ['admin']);
const adaStudent = randomUUID();
const beaStudent = randomUUID();
await db()`insert into children (id, family_id, kind, name, grade) values (${adaStudent}, ${ada.id}, 'student', ${'Noah Brook'}, ${'3'})`;
await db()`insert into children (id, family_id, kind, name, grade) values (${beaStudent}, ${bea.id}, 'student', ${'Mia Cole'}, ${'6'})`;

const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
const privateDoc = await saveSchoolDocument({
	title: 'Ada report card',
	category: 'Report cards',
	audience: 'family',
	grade: '',
	familyId: ada.id,
	publish: true,
	email: false,
	file: { bytes: pdf, name: 'ada.pdf', contentType: 'application/pdf' },
});
const publicDoc = await saveSchoolDocument({
	title: 'Family handbook',
	category: 'Handbooks and policies',
	audience: 'everyone',
	grade: '',
	familyId: '',
	publish: true,
	email: false,
	file: { bytes: pdf, name: 'handbook.pdf', contentType: 'application/pdf' },
});
if (!privateDoc.ok || !publicDoc.ok) throw new Error('seed documents failed');
const form = await saveSchoolForm({
	title: 'Photo release',
	instructions: 'One answer is enough.',
	audience: 'everyone',
	grade: '',
	dueOn: '2027-01-31',
	questions: [{ id: randomUUID(), label: 'Permission', type: 'yesno', required: true }],
	publish: true,
});
if (!form.ok) throw new Error(form.error);

// Local fixtures: tour reads no longer create dates at runtime.
const tourSlot = await addTourSlot({ date: '2028-05-21', start: '10:00', end: '11:00', capacity: 12, capacityUnit: 'people', published: true });
if (!tourSlot.ok && tourSlot.error !== 'That slot already exists.') throw new Error(tourSlot.error);
const tourRequest = randomUUID();
await db()`insert into tour_holds (id, family_id, kind, family_name, email, other_time, head_count)
  values (${tourRequest}, ${pat.id}, 'other', ${pat.name}, ${pat.email}, 'Wed · Morning', 3)`;

const seed = {
	password,
	tourRequest,
	pat,
	ada,
	bea,
	office,
	privateDoc: privateDoc.id,
	publicDoc: publicDoc.id,
	cookies: {
		ada: issueFamilySession(ada.id, ada.email),
		bea: issueFamilySession(bea.id, bea.email),
		pat: issueFamilySession(pat.id, pat.email),
		office: issueFamilySession(office.id, office.email),
	},
};
writeFileSync('/tmp/tca-e2e-seed.json', JSON.stringify(seed));
console.log('seeded', ada.email, bea.email);
