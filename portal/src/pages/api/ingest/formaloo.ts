import type { APIRoute } from 'astro';
import { handleFormaloo } from '../../../../../packages/school/src/incoming/http.ts';
export const prerender = false;
export const POST: APIRoute = ({request}) => handleFormaloo(request);
