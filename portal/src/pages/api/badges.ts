import type { APIRoute } from 'astro';
import { staffViewer } from '../../lib/classroom.ts';
import { conversationUnread, unreadAnnouncements, unreadCount } from '@tca/school';

export const prerender = false;

/**
 * Sidebar badges, fetched after the page shows so they never slow it down:
 * unread conversations for each Messages link this person has.
 */
// Student conversations plus direct and group ones.
const count = async (viewer: Parameters<typeof unreadCount>[0]) => (await Promise.all([unreadCount(viewer), conversationUnread(viewer)])).reduce((a, b) => a + b, 0);

export const GET: APIRoute = async (Astro) => {
	const family = Astro.locals.family;
	if (!family) return new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } });
	const roles = (Astro.locals.roles ?? []) as string[];
	const email = (Astro.locals.sessionEmail || family.email).toLowerCase();
	const out: Record<string, number> = {};
	const studentId = Astro.locals.access?.studentId;
	if (studentId) out['/s/messages'] = await unreadCount({ familyId: family.id, studentId, email, admin: false, staff: false });
	else {
		const [familyCount, staffCount, letters] = await Promise.all([
			roles.includes('guardian') ? count({ familyId: family.id, email, admin: false, staff: false }) : Promise.resolve(0),
			roles.includes('staff') || roles.includes('admin') ? count(staffViewer(Astro as any)) : Promise.resolve(0),
			roles.includes('guardian') ? unreadAnnouncements(email) : Promise.resolve(0),
		]);
		if (letters) out['/g/announcements'] = letters;
		if (familyCount) out['/g/messages'] = familyCount;
		if (staffCount) out['/staff/messages'] = staffCount;
	}
	return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } });
};
