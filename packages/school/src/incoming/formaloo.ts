import { chicagoInputToIso } from '../time.ts';
import { TOUR_STATUSES } from '../tours/model.ts';
import { incomingWritesAllowed, instant, object, text, type IncomingEnv, type IncomingInput } from './model.ts';
import { incomingImportCounts, upsertIncoming, setIncomingCursor } from './repository.ts';

const STAFF = { WwIRTQ8F: 'Proceed with interview', W6jXdl0Y: 'Pastoral Reference', n3PvOrQx: 'Interview Held', rEDOflNT: 'Not approved for application', '8ib6ivZo': 'Application sent', qtK2awJL: 'Family in ClassReach' };
const ENROLLMENT = { ogT5HdGj: 'Enrolled', TNpbhdrS: 'Enrolled at a different school', xNoSzNf5: 'Homeschooling', MJybD0cN: 'Not approved by school', '4HvsHxJR': 'Other' };
function choice(value: unknown, labels: Record<string, string>): string {
 const obj = object(value); const slug = text(value) || text(obj.slug);
 if (Object.hasOwn(labels, slug)) return labels[slug];
 const title = text(obj.title);
 return Object.values(labels).includes(title) ? title : '';
}
const PRIOR_YEAR_CUTOFF = Date.parse(chicagoInputToIso('2026-08-01T00:00'));
/** Deliberate allowlist: never return or persist the original row or rendered_data. */
export function parseFormalooRow(value: unknown): IncomingInput | null {
 const row = object(value), data = object(row.data);
 const externalId = text(row.slug), createdAt = instant(row.created_at);
 if (!externalId || !createdAt) return null;
 const formalooStatus = choice(data.tARX8tnm, STAFF), enrollmentStatus = choice(data.hoSng53c, ENROLLMENT);
 return {
  externalSource: 'formaloo', externalId, createdAt,
  name: [text(data.y4UJkoxY, 80), text(data.giNT8gN9, 80)].filter(Boolean).join(' '),
  email: text(data.WYuab4Hy, 254).toLowerCase(), phone: text(data.tE1IvVQs, 40), message: '',
  source: 'formaloo_interview', contactType: 'interview', status: formalooStatus ? TOUR_STATUSES.CONTACTED : TOUR_STATUSES.NEW,
  priorYear: Date.parse(createdAt) < PRIOR_YEAR_CUTOFF, alreadyFamily: formalooStatus === 'Family in ClassReach',
  contactedBy: formalooStatus ? 'Formaloo' : null, contactedAt: formalooStatus ? instant(row.updated_at) || createdAt : null,
  details: {
   enrollmentYear: text(data.PHzRpXmW),
   children: (Array.isArray(data.sVTtfsSQ) ? data.sVTtfsSQ : []).slice(0, 30).map(value => {
    const child = object(value); return { name: text(child.WzjCTEH2), grade: text(child.aFOckYce), currentSchool: text(child.qmLottiR) };
   }),
   ...(formalooStatus ? { formalooStatus } : {}), ...(enrollmentStatus ? { enrollmentStatus } : {}),
  },
 };
}
export type FormalooOptions = { key: string; secret: string; full?: boolean; fetch?: typeof fetch; pause?: (ms: number) => Promise<void> };
export async function fetchFormalooRows(options: FormalooOptions): Promise<IncomingInput[]> {
 const request = options.fetch || fetch;
 const tokenResponse = await request('https://api.formaloo.me/v3.0/oauth2/authorization-token/', {
  method: 'POST', headers: { 'x-api-key': options.key, Authorization: `Basic ${options.secret}` },
  body: (() => { const form = new FormData(); form.set('grant_type', 'client_credentials'); return form; })(), signal: AbortSignal.timeout(10000),
 });
 if (!tokenResponse.ok) throw new Error('Formaloo authorization failed');
 const token = text(object(await tokenResponse.json()).authorization_token, 8192);
 if (!token) throw new Error('Formaloo authorization failed');
 const rows: IncomingInput[] = [];
 for (let page = 1; page <= 100; page++) {
  if (page > 1) await (options.pause || (ms => new Promise(resolve => setTimeout(resolve, ms))))(200);
  const response = await request(`https://api.formaloo.me/v3.0/forms/JRqlqXml/rows/?page_size=100&page=${page}`, {
   headers: { 'x-api-key': options.key, Authorization: `JWT ${token}` }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Formaloo pull failed');
  const data = object(object(await response.json()).data);
  if (!Array.isArray(data.rows)) throw new Error('Formaloo response invalid');
  for (const row of data.rows) { const parsed = parseFormalooRow(row); if (parsed) rows.push(parsed); }
  if (options.full === false || !data.next) return rows;
 }
 throw new Error('Formaloo page limit exceeded');
}
export async function syncFormaloo(options: { env?: IncomingEnv; full?: boolean; dry?: boolean; fetch?: typeof fetch } = {}) {
 const env = options.env || process.env;
 if (!incomingWritesAllowed(env)) return { skipped: 'not-production' };
 if (!env.FORMALOO_API_KEY || !env.FORMALOO_API_SECRET) return { error: 'not-configured' };
 const rows = await fetchFormalooRows({ key: env.FORMALOO_API_KEY, secret: env.FORMALOO_API_SECRET, full: options.full, fetch: options.fetch });
 if (options.dry) return incomingImportCounts(rows);
 for (const row of rows) await upsertIncoming(row, { env });
 await setIncomingCursor('incoming_formaloo_last_sync', new Date().toISOString(), { env });
 return { rows: rows.length };
}
