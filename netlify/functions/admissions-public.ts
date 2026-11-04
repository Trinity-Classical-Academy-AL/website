import type { Config, Context } from '@netlify/functions';
import { handleAdmissionsRequest } from '../../src/lib/admissions/http.ts';

export default async (req: Request, _context: Context) => handleAdmissionsRequest(req);

export const config: Config = {
	path: ['/api/banner', '/api/banner/flyer', '/api/tours', '/api/tour-slots', '/api/tour-requests', '/api/interest', '/api/updates'],
};
