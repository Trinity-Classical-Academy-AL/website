import { runIncomingDigest } from '../../../packages/school/src/incoming/digest.ts';
export default async function incomingDigest() { return Response.json(await runIncomingDigest()); }
export const config = { schedule: '0 12,13 * * 1-5' };
