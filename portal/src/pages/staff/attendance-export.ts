import type { APIRoute } from 'astro';
import { staffViewer } from '../../lib/classroom.ts';
import { attendanceExport, csvResponse, schoolYearOf, teachingFor, toCsv } from '@tca/school';

export const prerender = false;

/** This year's attendance marks as a spreadsheet: every class for admins, a teacher's own homerooms otherwise. */
export const GET: APIRoute = async (Astro) => {
	const viewer = staffViewer(Astro as any);
	if (!viewer.admin && !viewer.staff) return new Response('No access.', { status: 403 });
	const year = schoolYearOf();
	const classIds = viewer.admin ? undefined : (await teachingFor(viewer.email, false)).classes.filter((row) => row.kind === 'homeroom' && row.teacherEmail === viewer.email).map((row) => row.id);
	const rows = await attendanceExport({ year, classIds });
	return csvResponse(`attendance-${year}.csv`, toCsv(rows, [
		{ key: 'day', label: 'Date' }, { key: 'student', label: 'Student' }, { key: 'grade', label: 'Grade' }, { key: 'className', label: 'Homeroom' },
		{ key: 'status', label: 'Status' }, { key: 'note', label: 'Note' }, { key: 'recordedBy', label: 'Recorded by' },
	]));
};
