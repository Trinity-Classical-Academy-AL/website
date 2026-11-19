// Fresh disposable database on a guarded local server; never resets the caller's database.
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { assertLocalDev } from '../packages/school/src/dev/local-guard.ts';
assertLocalDev();
const target = new URL(process.env.DATABASE_URL);
const database = `tca_dev_seed_smoke_${process.pid}`;
const control = postgres(target.toString(),{onnotice:()=>{}});
let sql;
try {
  await control.unsafe(`create database ${database}`);
  target.pathname='/'+database;process.env.DATABASE_URL=target.toString();
  const {seedRich}=await import('../scripts/dev/seed-rich.mjs');
  const {db}=await import('@tca/school');sql=db();
  const snapshot=async()=>{
    const tables=await sql`select tablename from pg_tables where schemaname='public' order by tablename`;
    const counts={};for(const {tablename}of tables)counts[tablename]=Number((await sql`select count(*) as n from ${sql(tablename)}`)[0].n);
    return counts;
  };
  await seedRich();const first=await snapshot();
  await seedRich();assert.deepEqual(await snapshot(),first,'Reseeding must preserve counts');
  const emails=await sql`select email from families union select email from family_emails union select email from inquiries union select email from updates_list`;
  assert.ok(emails.every(row=>row.email.endsWith('@example.com')));
  for(const table of ['tour_holds','students','events','rsvps','event_guest_rsvps','school_documents','school_forms','form_assignments','announcements','classreach_events','classreach_students'])assert.ok(first[table]>0,table);
  assert.equal((await sql`select distinct status from inquiries`).length,4);
  assert.equal((await sql`select distinct source from inquiries`).length,7);
  assert.equal((await sql`select distinct contact_type from inquiries`).length,6);
  assert.equal(first.inquiries,30);
  assert.equal(first.inquiry_activity,13);
  assert.ok((await sql`select * from inquiries where prior_year`).length);
  assert.ok((await sql`select * from inquiries where already_family`).length);
  assert.equal((await sql`select distinct status from time_requests`).length,3);
  assert.equal((await sql`select * from schedule_series where weekdays=array[3,4] and booking_window_days=92`).length,3);
  assert.ok((await sql`select * from tour_slots where slot_date < current_date`).length);
  assert.equal((await sql`select distinct capacity_unit from tour_slots`).length,2);
  assert.ok((await sql`select * from events where starts_at < now()`).length);
  assert.ok((await sql`select * from form_assignments where status='submitted'`).length);
  await seedRich({empty:true});const empty=await snapshot();
  assert.equal(empty.families,4);
  for(const table of ['tour_holds','students','events','rsvps','school_documents','school_forms','announcements','inquiries','inquiry_activity','schedule_series','classreach_students'])assert.equal(empty[table],0,table);
  await seedRich({ifEmpty:true});assert.equal((await snapshot()).events,0,'Startup preserves deliberately empty mode');
  console.log('Fresh DB: rich seed twice, fixture coverage, empty states and startup preservation passed.');
}finally{
  if(sql)await sql.end({timeout:2});
  await control.unsafe(`drop database if exists ${database} with (force)`);
  await control.end();
}
