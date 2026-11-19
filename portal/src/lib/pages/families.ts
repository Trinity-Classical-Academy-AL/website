import type { AstroGlobal } from 'astro';
import { formatChicago, listEnrolledFamilies } from '@tca/school';

/** Load data, run the existing actions, then derive the page's render model. */
export async function loadFamilies(Astro: AstroGlobal, family: NonNullable<AstroGlobal['locals']['family']>) {
	const q = (Astro.url.searchParams.get('q') || '').trim().toLowerCase();
	const rows = (await listEnrolledFamilies()).map((full) => ({
		id: full.id, name: full.name || full.email, email: full.email,
		students: full.students.map((student) => `${student.name}${student.grade ? `, ${student.grade}` : ''}`).join(' · ') || '—',
		enrolled: formatChicago(full.createdAt, false),
	}));
	const visible = rows.filter((row) => !q || `${row.name} ${row.email} ${row.students}`.toLowerCase().includes(q));
	return { q, visible };
}

export type FamiliesView = Exclude<Awaited<ReturnType<typeof loadFamilies>>, Response>;
