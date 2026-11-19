import type { APIRoute } from 'astro';
import { handleDigestPreview } from '../../../../../packages/school/src/incoming/http.ts';
export const prerender = false;
export const POST: APIRoute = ({request}) => handleDigestPreview(request);
