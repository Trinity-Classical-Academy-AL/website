import type { AstroGlobal } from 'astro';
import { runActions, toastFrom } from '../actions.ts';
import { csrfToken } from '../security.ts';
import {
	APPLICATION_STATUSES, addApplicationChild, formatChicago, removeApplicationChild, setChildEnrollment, listApplications, schoolYearOf, setApplicationStatus, shiftSchoolYear, syncApplications,
	type Application,
} from '@tca/school';

/**
 * Applications by school year. Tabs: the upcoming year (admissions season), the
 * current year, and past years (with a year filter). A row opens the
 * family's application in a sheet (?app=<id>) where staff change its stage and
 * set each child's enrollment.
 */
/** What staff search an application by: the family, its email and every child. */
const searchText = (app: Application) => `${app.name} ${app.email} ${app.children.map((kid) => kid.name).join(' ')}`;

export async function loadApplications(Astro: AstroGlobal, staff: NonNullable<AstroGlobal['locals']['family']>) {
	const csrf = csrfToken(Astro.cookies, Astro.url.protocol === 'https:');
	const by = Astro.locals.sessionEmail || staff.email || staff.name;
	const base = new URL(Astro.url); base.searchParams.delete('app');
	const closeUrl = base.pathname + base.search;
	const result = await runActions(Astro, {
		status: async (form) => {
			const outcome = await setApplicationStatus(String(form.get('id') ?? ''), String(form.get('status') ?? ''), by);
			return outcome.ok ? { redirect: Astro.url.pathname + Astro.url.search } : { error: outcome.error };
		},
		enrollment: async (form) => {
			const outcome = await setChildEnrollment({ applicationId: String(form.get('id') ?? ''), childId: String(form.get('childId') ?? ''), status: String(form.get('status') ?? ''), by });
			return outcome.ok ? { redirect: Astro.url.pathname + Astro.url.search } : { error: outcome.error };
		},
		'add-child': async (form) => {
			const app = (await listApplications()).find((item) => item.id === String(form.get('id') ?? ''));
			if (!app?.familyId) return { error: 'This family needs a portal account before children can be added.' };
			const outcome = await addApplicationChild({ applicationId: app.id, familyId: app.familyId, name: String(form.get('name') ?? ''), grade: String(form.get('grade') ?? '') });
			return outcome.ok ? { redirect: Astro.url.pathname + Astro.url.search } : { error: outcome.error };
		},
		'remove-child': async (form) => {
			const outcome = await removeApplicationChild({ applicationId: String(form.get('id') ?? ''), childName: String(form.get('name') ?? '') });
			return outcome.ok ? { redirect: Astro.url.pathname + Astro.url.search } : { error: outcome.error };
		},
	});
	if ('redirect' in result) return Astro.redirect(result.redirect, result.status);

	await syncApplications();
	const all = await listApplications();
	const current = schoolYearOf();
	const upcoming = shiftSchoolYear(current, 1);
	const params = Astro.url.searchParams;
	const tab = params.get('tab') === 'current' ? 'current' : params.get('tab') === 'past' ? 'past' : 'upcoming';
	const later = all.filter((app) => app.schoolYear > upcoming);
	const pastYears = [...new Set(all.filter((app) => app.schoolYear < current).map((app) => app.schoolYear))].sort().reverse();
	const year = tab === 'past' && pastYears.includes(params.get('year') || '') ? params.get('year')! : '';
	const status = APPLICATION_STATUSES.some((item) => item.value === params.get('status')) ? params.get('status')! : '';
	const q = (params.get('q') || '').trim().toLowerCase();
	const view = params.get('view') === 'table' ? 'table' : 'board';
	const inTab = (app: Application) => tab === 'upcoming' ? app.schoolYear >= upcoming : tab === 'current' ? app.schoolYear === current : app.schoolYear < current && (!year || app.schoolYear === year);
	const visible = all.filter((app) => inTab(app) && (!status || app.status === status)
		&& (!q || searchText(app).toLowerCase().includes(q)));
	const count = (test: (app: Application) => boolean) => all.filter(test).length;
	const href = (changes: Record<string, string>) => {
		const url = new URL(base);
		for (const [key, value] of Object.entries(changes)) value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
		return url.pathname + url.search;
	};
	const selected = all.find((app) => app.id === params.get('app')) ?? null;
	// Seats by grade for the year(s) on screen: children enrolled, still in progress, and waiting for a seat.
	const grades = new Map<string, { enrolled: number; open: number; waitlisted: number }>();
	for (const app of visible) {
		if (['declined', 'withdrawn'].includes(app.status)) continue;
		for (const kid of app.children) {
			if (kid.enrollment === 'withdrawn') continue;
			const key = kid.grade || '—';
			const entry = grades.get(key) ?? { enrolled: 0, open: 0, waitlisted: 0 };
			if (kid.enrollment === 'enrolled') entry.enrolled += 1;
			else if (kid.enrollment === 'waitlisted') entry.waitlisted += 1;
			else entry.open += 1;
			grades.set(key, entry);
		}
	}
	const days = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 86400000));
	return {
		csrf, error: result.error, view, searchText, grades: [...grades.entries()].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })), days, tab, current, upcoming, later: later.length > 0, pastYears, year, status, q, visible, selected, href, closeUrl,
		counts: { upcoming: count((app) => app.schoolYear >= upcoming), current: count((app) => app.schoolYear === current), past: count((app) => app.schoolYear < current) },
		submitted: (app: Application) => formatChicago(app.submittedAt, false),
		toast: toastFrom(Astro.url, {}),
	};
}

export type ApplicationsView = Exclude<Awaited<ReturnType<typeof loadApplications>>, Response>;
