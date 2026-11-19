import type { APIRoute } from 'astro';
import { handleNetlifyForms } from '../../../../../packages/school/src/incoming/http.ts';
export const prerender = false;
export const POST: APIRoute = ({request}) => handleNetlifyForms(request);
