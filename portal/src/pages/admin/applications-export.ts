import type { APIRoute } from 'astro';
import { ENROLLMENT_LABELS, applicationStatusLabel, csvResponse, listApplications, syncApplications, toCsv } from '@tca/school';

/**
 * Enrollment numbers for Concordis's dashboard (and anyone else who tracks
 * admissions outside the portal): one row per child on an application, with the
 * family's stage and the child's enrollment. ?year=2027–28 limits it to one year.
 */
export const prerender = false;

export const GET: APIRoute = async ({ locals, url }) => {
	if (!locals.roles?.includes('admin')) return new Response('No access.', { status: 403 });
	await syncApplications();
	const year = url.searchParams.get('year') || '';
	const day = (iso: string | null) => iso ? iso.slice(0, 10) : '';
	const rows = (await listApplications())
		.filter((app) => !year || app.schoolYear === year)
		.flatMap((app) => (app.children.length ? app.children : [null]).map((kid) => ({
			schoolYear: kid?.schoolYear || app.schoolYear,
			family: app.name,
			email: app.email,
			child: kid?.name ?? '',
			grade: kid?.grade ?? '',
			currentSchool: kid?.currentSchool ?? '',
			stage: applicationStatusLabel(app.status),
			enrollment: kid?.enrollment ? ENROLLMENT_LABELS[kid.enrollment] : '',
			source: app.source === 'formaloo' ? 'Formaloo' : 'Portal',
			requested: day(app.submittedAt),
			decided: day(app.decidedAt),
			updated: day(app.updatedAt),
		})));
	const columns = [
		{ key: 'schoolYear', label: 'School year' }, { key: 'family', label: 'Family' }, { key: 'email', label: 'Email' },
		{ key: 'child', label: 'Child' }, { key: 'grade', label: 'Grade' }, { key: 'currentSchool', label: 'Current school' },
		{ key: 'stage', label: 'Application stage' }, { key: 'enrollment', label: 'Enrollment' }, { key: 'source', label: 'Applied through' },
		{ key: 'requested', label: 'Requested' }, { key: 'decided', label: 'Decided' }, { key: 'updated', label: 'Last change' },
	];
	return csvResponse(`tca-enrollment${year ? `-${year}` : ''}.csv`, toCsv(rows, columns));
};
