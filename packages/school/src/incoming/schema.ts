/** Additive DDL, included in the existing content-hashed schema transaction. */
export const INCOMING_SCHEMA_SQL = `
alter table inquiries add column if not exists contact_type text not null default 'inquiry';
alter table inquiries add column if not exists external_source text not null default '';
alter table inquiries add column if not exists external_id text;
alter table inquiries add column if not exists contacted_at timestamptz;
alter table inquiries add column if not exists contacted_by text;
alter table inquiries add column if not exists prior_year boolean not null default false;
alter table inquiries add column if not exists already_family boolean not null default false;
create unique index if not exists inquiries_external_id on inquiries (external_source, external_id) where external_id is not null;
create table if not exists inquiry_activity (
 id uuid primary key,
 inquiry_id uuid not null references inquiries(id) on delete cascade,
 at timestamptz not null default now(),
 by text,
 kind text not null check (kind in ('imported','contacted','note','status','emailed')),
 note text
);
create index if not exists inquiry_activity_inquiry on inquiry_activity (inquiry_id, at);
`;
/** Safe to repeat; external imports already carry their explicit type. Run only behind the shared write guard. */
export const INCOMING_BACKFILL_SQL = `
update inquiries set contact_type = case
 when source in ('interview','formaloo_interview') then 'interview'
 when source = 'newsletter' then 'newsletter'
 when source = 'visit' or details->>'interest' = 'visiting' then 'visit'
 when source = 'teaching' or details->>'interest' = 'teaching' then 'teaching'
 when source = 'other' or details->>'interest' = 'other' then 'other'
 else 'inquiry' end
where external_id is null and contact_type is distinct from (case
 when source in ('interview','formaloo_interview') then 'interview'
 when source = 'newsletter' then 'newsletter'
 when source = 'visit' or details->>'interest' = 'visiting' then 'visit'
 when source = 'teaching' or details->>'interest' = 'teaching' then 'teaching'
 when source = 'other' or details->>'interest' = 'other' then 'other'
 else 'inquiry' end);
`;
