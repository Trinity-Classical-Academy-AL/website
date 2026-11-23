import { db, dbReady, type Sql } from '../db.ts';
import { sendEmail, staffNotifyEmail, portalOrigin } from '../email.ts';
import { CHICAGO, chicagoToday, isoToChicagoInput } from '../time.ts';
import { incomingDate, incomingWritesAllowed, type IncomingEnv, type IncomingRow } from './model.ts';
import { queryIncoming } from './repository.ts';

export function digestDue(now = new Date(), weekdaysOnly = true): boolean {
 const local = isoToChicagoInput(now.toISOString());
 const weekday = new Intl.DateTimeFormat('en-US',{timeZone:CHICAGO,weekday:'short'}).format(now);
 return local.endsWith('T07:00') && (!weekdaysOnly || !['Sat','Sun'].includes(weekday));
}
export function formalooCatchupDue(now = new Date()): boolean { return isoToChicagoInput(now.toISOString()).endsWith('T06:30'); }
export function buildDigest(rows: IncomingRow[], lastSent: string | null, now = new Date(), origin = portalOrigin()): string | null {
 const eligible = rows.filter(row => !row.priorYear && !row.alreadyFamily && row.contactType !== 'newsletter');
 const since = lastSent ? Date.parse(lastSent) : now.getTime() - 86400000;
 const newRows = eligible.filter(row => Date.parse(row.createdAt) > since && Date.parse(row.createdAt) <= now.getTime());
 const overdue = eligible.filter(row => row.status === 'new' && !row.contactedAt && now.getTime()-Date.parse(row.createdAt) >= 14*86400000 && now.getTime()-Date.parse(row.createdAt) <= 60*86400000);
 if (!newRows.length && !overdue.length) return null;
 const line = (row: IncomingRow) => `${row.name || row.email} · ${row.contactType} · ${incomingDate(row.createdAt)} · ${origin}/admin/families?family=${row.id}`;
 const newsletter = rows.filter(row => row.contactType === 'newsletter' && !row.priorYear && !row.alreadyFamily && Date.parse(row.createdAt) > since && Date.parse(row.createdAt) <= now.getTime()).length;
 return [newRows.length ? ['New since last digest',...newRows.map(line)].join('\n') : '', overdue.length ? ['Waiting 14+ days with no contact',...overdue.map(line)].join('\n') : '',newsletter ? `${newsletter} newsletter signups` : ''].filter(Boolean).join('\n\n');
}
type DigestData = {rows: IncomingRow[]; lastSent: string | null; enabled: unknown};
export async function loadDigestData(sql: Sql = db()): Promise<DigestData> {
 const settings = await sql`select key,value from settings where key in ('incoming_digest_last_sent','incoming_digest_enabled')`;
 const value = (key: string) => settings.find(row=>row.key===key)?.value;
 return { rows:await queryIncoming(sql), lastSent:typeof value('incoming_digest_last_sent')==='string' ? value('incoming_digest_last_sent') : null, enabled:value('incoming_digest_enabled') };
}
export async function previewIncomingDigest(now = new Date()): Promise<string> {
 // Read only, including on first deployment: no migration or cursor changes.
 const data = await loadDigestData();
 return buildDigest(data.rows,data.lastSent,now) || '';
}
type DigestOptions = {env?: IncomingEnv; now?: Date; load?:()=>Promise<DigestData>; send?:typeof sendEmail; record?:(value:string)=>Promise<void>};
export async function runIncomingDigest(options: DigestOptions = {}): Promise<{skipped?:string;sent?:boolean}> {
 const env=options.env || process.env, now=options.now || new Date();
 if (!incomingWritesAllowed(env)) return {skipped:'not-production'};
 if (env.INCOMING_DIGEST==='off') return {skipped:'disabled'};
 if (!digestDue(now)) return {skipped:'outside-schedule'};
 // What to send, or why not, from the loaded data.
 const decide=(data:DigestData):{skipped:string}|{text:string}=>{
  if (data.enabled==='off' || data.enabled===false) return {skipped:'disabled'};
  if (data.lastSent && chicagoToday(new Date(data.lastSent))===chicagoToday(now)) return {skipped:'already-sent'};
  const text=buildDigest(data.rows,data.lastSent,now);
  return text ? {text} : {skipped:'empty'};
 };
 const send=(text:string)=>(options.send || sendEmail)({to:staffNotifyEmail(),subject:'Incoming contacts',text});
 if (options.load && options.record) {
  const plan=decide(await options.load());
  if ('skipped' in plan) return plan;
  const result=await send(plan.text);
  // Local sendEmail logs only, so it never records a delivered digest.
  if (!result.delivered) return {skipped:result.reason || 'not-sent'};
  await options.record(now.toISOString());return {sent:true};
 }
 await dbReady();
 // Claim today's digest inside a locked transaction, then send outside it: sendEmail checks for duplicates and
 // logs through the same single database connection, which an open transaction would block forever.
 const plan=await db().begin(async tx=>{
  // A transaction lock protects simultaneous schedules/instances, not just this process.
  await tx`select pg_advisory_xact_lock(1952670067, 42)`;
  const data=await loadDigestData(tx as unknown as Sql);
  const decision=decide(data);
  if ('skipped' in decision) return decision;
  await tx`insert into settings(key,value)values('incoming_digest_last_sent',${tx.json(now.toISOString())}) on conflict(key)do update set value=excluded.value`;
  return {...decision,previous:data.lastSent};
 });
 if ('skipped' in plan) return plan;
 let result: Awaited<ReturnType<typeof sendEmail>> = {delivered:false};
 try { result=await send(plan.text); }
 finally {
  // Undelivered: put the previous marker back so the next run can send.
  if (!result.delivered) {
   if (plan.previous===null) await db()`delete from settings where key='incoming_digest_last_sent'`;
   else await db()`update settings set value=${db().json(plan.previous)} where key='incoming_digest_last_sent'`;
  }
 }
 if (!result.delivered) return {skipped:result.reason || 'not-sent'};
 return {sent:true};
}
