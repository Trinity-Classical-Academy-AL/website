import { randomUUID } from 'node:crypto';
import { db, dbReady, type Sql } from '../db.ts';
import { incomingWritesAllowed, contactType, object, type IncomingInput, type IncomingRow, type IncomingActivity, type IncomingEnv } from './model.ts';

type WriteOptions = { env?: IncomingEnv };
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value || '');
function toRow(row: Record<string, any>): IncomingRow {
 return { id: String(row.id), createdAt: iso(row.created_at), status: row.status, name: row.name, email: row.email,
  phone: row.phone, message: row.message, source: row.source, contactType: row.external_id ? row.contact_type : contactType(row.source, row.details?.interest),
  externalSource: row.external_source, externalId: row.external_id, details: object(row.details), priorYear: row.prior_year,
  alreadyFamily: row.already_family, contactedAt: row.contacted_at ? iso(row.contacted_at) : null, contactedBy: row.contacted_by,
 };
}
export async function queryIncoming(sql: Sql = db()): Promise<IncomingRow[]> {
 return (await sql`select * from inquiries order by created_at desc, id`).map(toRow);
}
export async function listIncoming(): Promise<IncomingRow[]> { await dbReady(); return queryIncoming(); }
export async function incomingActivity(id: string): Promise<IncomingActivity[]> {
 await dbReady();
 return (await db()`select * from inquiry_activity where inquiry_id=${id} order by at desc, id`).map(row => ({id:row.id,at:iso(row.at),by:row.by || '',kind:row.kind,note:row.note || ''}));
}
async function isFamily(sql: Sql, email: string): Promise<boolean> {
 if (!email) return false;
 const [row] = await sql`select exists(
  select 1 from families where lower(email)=lower(${email})
  union all select 1 from family_emails where lower(email)=lower(${email})
  union all select 1 from classreach_guardians where lower(email)=lower(${email})
 ) as found`;
 return row.found;
}
/** Fill blanks recursively, retaining staff edits and all existing nonempty values. */
function fillMissing(existing: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
 const merged = {...existing};
 for (const [key, value] of Object.entries(incoming)) {
  const before = merged[key];
  if (before === undefined || before === null || before === '' || (Array.isArray(before) && before.length === 0)) merged[key] = value;
  else if (Object.keys(object(before)).length) merged[key] = fillMissing(object(before), object(value));
 }
 return merged;
}
export async function upsertIncoming(input: IncomingInput, options: WriteOptions = {}): Promise<{id: string; inserted: boolean} | {skipped: string}> {
 if (!incomingWritesAllowed(options.env)) return {skipped:'not-production'};
 await dbReady();
 return db().begin(async tx => {
  const sql = tx as unknown as Sql;
  await sql`select pg_advisory_xact_lock(hashtextextended(${input.externalSource + ':' + input.externalId}, 0))`;
  const [existing] = await sql`select * from inquiries where external_source=${input.externalSource} and external_id=${input.externalId} for update`;
  const alreadyFamily = input.alreadyFamily || await isFamily(sql, existing?.email || input.email);
  if (existing) {
   await sql`update inquiries set already_family=${alreadyFamily},
    name=case when name='' then ${input.name} else name end,
    email=case when email='' then ${input.email} else email end,
    phone=case when phone='' then ${input.phone} else phone end,
    message=case when message='' then ${input.message} else message end,
    details=${sql.json(fillMissing(object(existing.details), input.details))}
    where id=${existing.id}`;
   return {id:String(existing.id),inserted:false};
  }
  const id = randomUUID();
  await sql`insert into inquiries(id,created_at,status,email,name,phone,message,source,details,contact_type,external_source,external_id,contacted_at,contacted_by,prior_year,already_family)
   values(${id},${input.createdAt},${input.status},${input.email},${input.name},${input.phone},${input.message},${input.source},${sql.json(input.details)},${input.contactType},${input.externalSource},${input.externalId},${input.contactedAt},${input.contactedBy},${input.priorYear},${alreadyFamily})`;
  await sql`insert into inquiry_activity(id,inquiry_id,by,kind,note) values(${randomUUID()},${id},${input.externalSource},'imported',${input.details.formalooStatus ? `Formaloo status: ${input.details.formalooStatus}` : `Imported from ${input.externalSource}`})`;
  return {id,inserted:true};
 });
}
export async function incomingImportCounts(rows: IncomingInput[]) {
 // Read-only: dry runs deliberately do not invoke dbReady (which may migrate).
 const existing = await db()`select external_source,external_id from inquiries where external_id is not null`;
 const keys = new Set(existing.map(row => row.external_source + ':' + row.external_id));
 const unique = new Map(rows.map(row => [row.externalSource + ':' + row.externalId, row]));
 const wouldUpdate = [...unique.keys()].filter(key => keys.has(key)).length;
 return {rows:rows.length,wouldInsert:unique.size-wouldUpdate,wouldUpdate};
}
export async function markContacted(id: string, by: string, kind: 'contacted' | 'emailed' = 'contacted', options: WriteOptions = {}) {
 if (!incomingWritesAllowed(options.env)) return {skipped:'not-production'};
 if (!/^[\da-f-]{36}$/i.test(id)) return {error:'Contact not found.'};
 await dbReady();
 return db().begin(async tx => {
  const rows = await tx`update inquiries set status='contacted', contacted_at=now(), contacted_by=${by.slice(0,254)} where id=${id} returning id`;
  if (!rows.length) return {error:'Contact not found.'};
  await tx`insert into inquiry_activity(id,inquiry_id,by,kind,note) values(${randomUUID()},${id},${by.slice(0,254)},${kind},${kind === 'emailed' ? 'Opened email' : 'Marked contacted'})`;
  return {ok:true};
 });
}
export async function markProspectEmailed(id: string, by: string, options: WriteOptions = {}) {
 if (!incomingWritesAllowed(options.env)) return {skipped:'not-production'};
 if (!/^[\da-f-]{36}$/i.test(id)) return {error:'Prospect not found.'};
 await dbReady();
 const [person]=await db()`select * from families where id=${id} and 'prospect'=any(roles) and not ('guardian'=any(roles))`;
 if (!person) return {error:'Prospect not found.'};
 const saved=await upsertIncoming({externalSource:'portal-account',externalId:id,createdAt:iso(person.created_at),name:person.name,email:person.email,phone:person.phone,message:'',source:'portal',contactType:'inquiry',details:{},status:'new',priorYear:false,alreadyFamily:false,contactedAt:null,contactedBy:null},options);
 if ('skipped' in saved) return saved;
 return markContacted(saved.id,by,'emailed',options);
}
export async function addIncomingNote(id: string, by: string, note: string, options: WriteOptions = {}) {
 if (!incomingWritesAllowed(options.env)) return {skipped:'not-production'};
 const clean = note.trim().slice(0,2000);
 if (!clean) return {error:'Add a note.'};
 if (!/^[\da-f-]{36}$/i.test(id)) return {error:'Contact not found.'};
 await dbReady();
 await db()`insert into inquiry_activity(id,inquiry_id,by,kind,note) select ${randomUUID()},id,${by.slice(0,254)},'note',${clean} from inquiries where id=${id}`;
 return {ok:true};
}
export async function setIncomingCursor(key: string, value: string, options: WriteOptions = {}) {
 if (!incomingWritesAllowed(options.env)) return {skipped:'not-production'};
 await dbReady();
 await db()`insert into settings(key,value) values(${key},${db().json(value)}) on conflict(key) do update set value=excluded.value`;
 return {ok:true};
}
