import type { AstroGlobal } from 'astro';
import { chicagoToday, listTerms, schoolYearOf, termFor, type Term } from '@tca/school';

/** Who's looking at a staff page: their email, and whether they're an admin (who sees every class). */
export function staffViewer(Astro: AstroGlobal) {
	const roles = (Astro.locals.roles ?? []) as string[];
	return { email: (Astro.locals.sessionEmail || Astro.locals.family?.email || '').toLowerCase(), admin: roles.includes('admin'), staff: roles.includes('staff'), familyId: Astro.locals.family?.id };
}

/** The term picked in the URL (?term=), else the current one. */
export async function pickTerm(Astro: AstroGlobal): Promise<{ terms: Term[]; term: Term | null }> {
	const terms = await listTerms(schoolYearOf());
	const term = terms.find((item) => item.id === Astro.url.searchParams.get('term')) ?? termFor(terms, chicagoToday());
	return { terms, term };
}

export const shortDay = (day: string) => new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
export const longDay = (day: string) => new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
