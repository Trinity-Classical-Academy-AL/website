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
 const line = (row: IncomingRow) => `${row.name || row.email} · ${row.contactType} · ${incomingDate(row.createdAt)} · ${origin}/admin/prospects?contact=${row.id}`;
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
 const run=async(load:()=>Promise<DigestData>,record:(value:string)=>Promise<void>)=>{
  const data=await load();
  if (data.enabled==='off' || data.enabled===false) return {skipped:'disabled'};
  if (data.lastSent && chicagoToday(new Date(data.lastSent))===chicagoToday(now)) return {skipped:'already-sent'};
  const text=buildDigest(data.rows,data.lastSent,now);
  if (!text) return {skipped:'empty'};
  const result=await (options.send || sendEmail)({to:staffNotifyEmail(),subject:'Incoming contacts',text});
  // Local sendEmail logs only, so it never records a delivered digest.
  if (!result.delivered) return {skipped:result.reason || 'not-sent'};
  await record(now.toISOString());return {sent:true};
 };
 if (options.load && options.record) return run(options.load,options.record);
 await dbReady();
 return db().begin(async tx=>{
  // A transaction lock protects simultaneous schedules/instances, not just this process.
  await tx`select pg_advisory_xact_lock(1952670067, 42)`;
  return run(()=>loadDigestData(tx as unknown as Sql),async value=>{
   await tx`insert into settings(key,value)values('incoming_digest_last_sent',${tx.json(value)}) on conflict(key)do update set value=excluded.value`;
  });
 });
}
