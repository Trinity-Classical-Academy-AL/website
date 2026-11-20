import type { AstroGlobal } from 'astro';
import { runActions, toastFrom } from '../actions.ts';
import { csrfToken } from '../security.ts';
import {
	APPLICATION_STATUSES, formatChicago, listApplications, schoolYearOf, setApplicationStatus, shiftSchoolYear, syncApplications,
	type Application,
} from '@tca/school';

/**
 * Applications by school year. Tabs: the upcoming year (admissions season), the
 * current year, and past years (with a year filter). A row opens the
 * application in a sheet (?app=<id>) where staff change its status.
 */
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
	const inTab = (app: Application) => tab === 'upcoming' ? app.schoolYear >= upcoming : tab === 'current' ? app.schoolYear === current : app.schoolYear < current && (!year || app.schoolYear === year);
	const visible = all.filter((app) => inTab(app) && (!status || app.status === status)
		&& (!q || `${app.name} ${app.email} ${app.students.map((student) => student.name).join(' ')}`.toLowerCase().includes(q)));
	const count = (test: (app: Application) => boolean) => all.filter(test).length;
	const href = (changes: Record<string, string>) => {
		const url = new URL(base);
		for (const [key, value] of Object.entries(changes)) value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
		return url.pathname + url.search;
	};
	const selected = all.find((app) => app.id === params.get('app')) ?? null;
	return {
		csrf, error: result.error, tab, current, upcoming, later: later.length > 0, pastYears, year, status, q, visible, selected, href, closeUrl,
		counts: { upcoming: count((app) => app.schoolYear >= upcoming), current: count((app) => app.schoolYear === current), past: count((app) => app.schoolYear < current) },
		submitted: (app: Application) => formatChicago(app.submittedAt, false),
		toast: toastFrom(Astro.url, {}),
	};
}

export type ApplicationsView = Exclude<Awaited<ReturnType<typeof loadApplications>>, Response>;
