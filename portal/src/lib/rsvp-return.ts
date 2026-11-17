import { guestRsvpEvent } from '@tca/school';
import { safeNext } from './security.ts';

export async function rsvpReturnNotice(next: string | null, lookup = guestRsvpEvent): Promise<string> {
	const path = safeNext(next);
	if (!path?.startsWith('/rsvp/')) return '';
	const event = await lookup(path.slice('/rsvp/'.length));
	return event ? `Create an account or sign in to RSVP for ${event.title}.` : 'Create an account or sign in to RSVP.';
}
