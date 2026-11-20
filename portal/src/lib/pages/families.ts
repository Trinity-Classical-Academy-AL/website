import type { AstroGlobal } from 'astro';
import {
	addFamilyNote, addIncomingNote, csvResponse, formatChicago, incomingActivity, incomingDate, listFamilyAccounts, listFamilyActivity, listIncoming, listJoinRequests,
	listUpdateSignups, markContacted, markProspectEmailed, toCsv,
	listApplications, syncApplications, type Application, type FamilyAccount, type IncomingRow,
} from '@tca/school';
import { runActions } from '../actions.ts';
import { csrfToken } from '../security.ts';

/**
 * Families directory. A family is a household: one portal account and/or the
 * emails we know for it. The moment we have an email, there is a family.
 * Sources are grouped by email: an account claims all of its emails; inquiries and
 * updates-list sign-ups join the account that owns their email, or start an
 * email-only family. Stage is derived from what the family has done.
 */
export const STAGES = [
	{ value: 'updates', label: 'Updates list' },
	{ value: 'inquired', label: 'Inquired' },
	{ value: 'account', label: 'Has account' },
	{ value: 'tour', label: 'Tour booked' },
	{ value: 'applied', label: 'Applied' },
	{ value: 'enrolled', label: 'Enrolled' },
] as const;
export type Stage = (typeof STAGES)[number]['value'];
export const stageLabel = (stage: Stage) => STAGES.find((item) => item.value === stage)!.label;

/** Follow-up on the family's inquiries: '' when there is nothing to follow up. */
export const FOLLOW_UPS = [
	{ value: 'new', label: 'Needs reply' },
	{ value: 'overdue', label: 'No reply 14+ days' },
	{ value: 'contacted', label: 'Contacted' },
	{ value: 'confirmed', label: 'Confirmed' },
	{ value: 'cancelled', label: 'Cancelled' },
] as const;
export type FollowUp = (typeof FOLLOW_UPS)[number]['value'] | '';
export const followUpLabel = (value: FollowUp) => FOLLOW_UPS.find((item) => item.value === value)?.label ?? '—';

const DAY = 86400000;

export type FeedItem = { at: string; by: string; label: string; note: string };
const FEED_LABELS: Record<string, string> = {
	note: 'Note', merged: 'Families combined', request: 'Join request', joined: 'Joined',
	imported: 'Imported', contacted: 'Contacted', emailed: 'Emailed', status: 'Status changed',
};
/** Family notes and every inquiry's contact history, newest first. */
export async function familyFeed(row: Pick<DirectoryFamily, 'account' | 'inquiries'>): Promise<FeedItem[]> {
	const [own, ...perInquiry] = await Promise.all([
		row.account ? listFamilyActivity(row.account.id) : Promise.resolve([]),
		...row.inquiries.map((inquiry) => incomingActivity(inquiry.id)),
	]);
	return [...own, ...perInquiry.flat()]
		.map((item) => ({ at: item.at, by: item.by, label: FEED_LABELS[item.kind] ?? item.kind, note: item.note }))
		.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export type DirectoryFamily = {
	/** Account id, else the newest inquiry id, else `u:<email>`. Any record id finds the family. */
	key: string;
	account: FamilyAccount | null;
	name: string;
	emails: string[];
	phone: string;
	stage: Stage;
	children: string[];
	tour: string;
	inquiries: IncomingRow[];
	applications: Application[];
	updates: { email: string; createdAt: string; source: string }[];
	firstAt: string;
	lastAt: string;
	followUp: FollowUp;
	contactedAt: string | null;
	contactedBy: string | null;
	/** Only old inquiries, no account: hidden unless the date filter is "All time". */
	priorYear: boolean;
};

export function buildDirectory(accounts: FamilyAccount[], inquiries: IncomingRow[], signups: { email: string; createdAt: string; source: string }[], now = Date.now(), applications: Application[] = []): DirectoryFamily[] {
	type Draft = { account: FamilyAccount | null; emails: Set<string>; inquiries: IncomingRow[]; updates: typeof signups; applications: Application[] };
	const byEmail = new Map<string, Draft>();
	const drafts: Draft[] = [];
	const draftFor = (email: string) => {
		const key = email.trim().toLowerCase();
		let draft = byEmail.get(key);
		if (!draft) { draft = { account: null, emails: new Set([key]), inquiries: [], updates: [], applications: [] }; drafts.push(draft); byEmail.set(key, draft); }
		return draft;
	};
	for (const account of accounts) {
		const draft: Draft = { account, emails: new Set(account.emails), inquiries: [], updates: [], applications: [] };
		drafts.push(draft);
		for (const email of account.emails) if (!byEmail.has(email)) byEmail.set(email, draft);
	}
	for (const row of inquiries) if (row.email) draftFor(row.email).inquiries.push(row);
	for (const row of signups) if (row.email) draftFor(row.email).updates.push(row);
	for (const row of applications) {
		const draft = (row.familyId && drafts.find((item) => item.account?.id === row.familyId)) || (row.email ? draftFor(row.email) : null);
		draft?.applications.push(row);
	}

	return drafts.map(({ account, emails, inquiries: own, updates, applications: apps }) => {
		own.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
		const named = own.find((row) => row.name);
		const roles = account?.roles ?? [];
		const real = own.filter((row) => row.contactType !== 'newsletter');
		// Enrolled: a guardian account, or Formaloo's separate Enrollment Status says so.
		const enrolledInFormaloo = own.some((row) => (row.details as { enrollmentStatus?: string })?.enrollmentStatus === 'Enrolled')
			|| apps.some((app) => (app.answers as { enrollmentStatus?: string })?.enrollmentStatus === 'Enrolled');
		const stage: Stage = roles.includes('guardian') || enrolledInFormaloo ? 'enrolled'
			: apps.some((app) => app.status !== 'withdrawn' && app.status !== 'declined') ? 'applied'
			: account?.tour.startsWith('Booked') || real.some((row) => row.contactType === 'visit' && row.status === 'confirmed') ? 'tour'
			: account ? 'account'
			: real.length ? 'inquired' : 'updates';
		const open = own.filter((row) => row.status === 'new');
		const followUp: FollowUp = open.some((row) => !row.contactedAt && now - Date.parse(row.createdAt) >= 14 * DAY) ? 'overdue'
			: open.length ? 'new' : (own[0]?.status as FollowUp | undefined) ?? '';
		const contacted = own.filter((row) => row.contactedAt).sort((a, b) => Date.parse(b.contactedAt!) - Date.parse(a.contactedAt!))[0];
		const times = [account?.createdAt, account?.lastSignInAt, ...own.map((row) => row.createdAt), ...updates.map((row) => row.createdAt)]
			.filter((value): value is string => !!value).map((value) => Date.parse(value)).filter(Number.isFinite);
		const email = account?.email.toLowerCase() ?? [...emails][0];
		return {
			key: account?.id ?? own[0]?.id ?? `u:${email}`,
			account,
			name: account?.householdName || account?.name || named?.name || '',
			emails: [email, ...[...emails].filter((other) => other !== email)],
			phone: account?.phone || own.find((row) => row.phone)?.phone || '',
			stage,
			children: account?.children ?? [],
			tour: account?.tour ?? '',
			inquiries: own,
			applications: apps,
			updates,
			firstAt: new Date(Math.min(...times)).toISOString(),
			lastAt: new Date(Math.max(...times)).toISOString(),
			followUp,
			contactedAt: contacted?.contactedAt ?? null,
			contactedBy: contacted?.contactedBy ?? null,
			priorYear: !account && own.length > 0 && own.every((row) => row.priorYear),
		};
	}).sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));
}

export const findFamily = (rows: DirectoryFamily[], key: string | null) => key
	? rows.find((row) => row.key === key || row.account?.id === key || row.inquiries.some((inquiry) => inquiry.id === key)) ?? null
	: null;

export async function loadFamilyDirectory(Astro: AstroGlobal, family: NonNullable<AstroGlobal['locals']['family']>) {
	const csrf = csrfToken(Astro.cookies, Astro.url.protocol === 'https:');
	const base = new URL(Astro.url); base.searchParams.delete('family');
	const closeUrl = base.pathname + base.search;
	const by = Astro.locals.sessionEmail || family.email || family.name;
	const saved = <T extends object>(result: T | { error: string } | { skipped: string }) =>
		'error' in result ? { error: result.error } : 'skipped' in result ? { error: 'Contact updates are available in production.' } : { redirect: closeUrl };
	const result = await runActions(Astro, {
		'email-account': async (form) => saved(await markProspectEmailed(String(form.get('id') || ''), by)),
		emailed: async (form) => saved(await markContacted(String(form.get('id') || ''), by, 'emailed')),
		// Notes keep the sheet open: back to the same URL, which still has ?family=.
		// Account families keep notes on the family; email-only families on their inquiry.
		note: async (form) => {
			const note = String(form.get('note') || '');
			const outcome = saved(form.get('family') ? await addFamilyNote(String(form.get('family')), by, note) : await addIncomingNote(String(form.get('id') || ''), by, note));
			return 'error' in outcome ? outcome : { redirect: Astro.url.pathname + Astro.url.search };
		},
		// Marks every open inquiry of the family at once.
		contacted: async (form) => {
			for (const id of form.getAll('id').map(String)) {
				const outcome = saved(await markContacted(id, by));
				if ('error' in outcome) return outcome;
			}
			return { redirect: closeUrl };
		},
	});
	if ('redirect' in result) return Astro.redirect(result.redirect, result.status);

	await syncApplications();
	const [accounts, inquiries, signups, requests, applications] = await Promise.all([listFamilyAccounts(), listIncoming(), listUpdateSignups(), listJoinRequests(), listApplications()]);
	const joining = new Set(requests.flatMap((request) => [request.fromFamilyId, request.toFamilyId]));
	const now = Date.now();
	const rows = buildDirectory(accounts, inquiries, signups, now, applications);

	const params = Astro.url.searchParams;
	const pick = <T extends string>(key: string, allowed: readonly T[]) => (allowed as readonly string[]).includes(params.get(key) || '') ? params.get(key) as T : '';
	const tab = pick('tab', ['enrolled', 'prospects'] as const) || 'all';
	const stage = pick('stage', STAGES.map((item) => item.value));
	const filter = pick('filter', [...FOLLOW_UPS.map((item) => item.value), 'none'] as const);
	const activity = pick('activity', ['7', '30', '90', 'all'] as const);
	const contacted = pick('contacted', ['no', 'me', 'others'] as const);
	const q = (params.get('q') || '').trim().toLowerCase();

	const visible = rows.filter((row) => {
		if (tab === 'prospects' && row.stage === 'enrolled') return false;
		if (tab === 'enrolled' && row.stage !== 'enrolled') return false;
		if (activity !== 'all' && row.priorYear) return false;
		if (activity && activity !== 'all' && now - Date.parse(row.lastAt) > Number(activity) * DAY) return false;
		if (stage && row.stage !== stage) return false;
		if (filter === 'none' ? row.followUp !== '' : filter && row.followUp !== filter) return false;
		if (contacted === 'no' && row.contactedAt) return false;
		if (contacted === 'me' && row.contactedBy !== by) return false;
		if (contacted === 'others' && (!row.contactedAt || row.contactedBy === by)) return false;
		return !q || searchText(row).includes(q);
	});

	// Legacy links (/admin/prospects?contact=<inquiry id>) land here as ?family=<id>.
	const selected = findFamily(rows, params.get('family'));
	const focus = selected?.inquiries.find((row) => row.status === 'new') ?? selected?.inquiries[0] ?? null;
	const feed = selected ? await familyFeed(selected) : [];
	const href = (changes: Record<string, string>) => {
		const url = new URL(base);
		for (const [key, value] of Object.entries(changes)) value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
		return url.pathname + url.search;
	};
	return {
		csrf, error: result.error, by, tab, stage, filter, activity, contacted, q,
		visible, selected, focus, feed, href, closeUrl, joining,
		contactedLabel: `${by} · ${incomingDate(new Date().toISOString())}`,
		exportResponse: () => csvResponse('families.csv', toCsv(visible.map((row) => ({
			name: row.name, emails: row.emails.join(' '), phone: row.phone, stage: stageLabel(row.stage),
			children: row.children.join(', '), followUp: followUpLabel(row.followUp), lastActivity: formatChicago(row.lastAt, false),
			contacted: row.contactedAt ? `${row.contactedBy || 'Staff'} ${incomingDate(row.contactedAt)}` : '',
		})), [
			{ key: 'name', label: 'Name' }, { key: 'emails', label: 'Emails' }, { key: 'phone', label: 'Phone' },
			{ key: 'stage', label: 'Stage' }, { key: 'children', label: 'Children' }, { key: 'followUp', label: 'Follow-up' },
			{ key: 'lastActivity', label: 'Last activity' }, { key: 'contacted', label: 'Contacted' },
		])),
	};
}

export const searchText = (row: DirectoryFamily) => `${row.name} ${row.emails.join(' ')} ${row.children.join(' ')}`.toLowerCase();

export type FamilyDirectoryView = Exclude<Awaited<ReturnType<typeof loadFamilyDirectory>>, Response>;
