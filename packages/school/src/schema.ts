import { INCOMING_SCHEMA_SQL, INCOMING_BACKFILL_SQL } from './incoming/schema.ts';
/** Applied on first use. Safe to run more than once. */
export const SCHEMA_SQL = `
create table if not exists settings (
  key text primary key,
  value jsonb not null
);

create table if not exists families (
  id uuid primary key,
  name text not null,
  email text not null unique,
  phone text not null default '',
  password_hash text not null,
  email_verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists email_tokens (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  purpose text not null check (purpose in ('verify', 'reset')),
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table if not exists tour_dates (
  date date primary key,
  start_time text not null,
  end_time text not null,
  capacity integer not null check (capacity >= 0 and capacity <= 200),
  enabled boolean not null default true
);

create table if not exists tour_requests (
  id uuid primary key,
  created_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new', 'contacted', 'cancelled')),
  tour_date date not null,
  parent_name text not null,
  email text not null,
  phone text not null,
  children integer not null default 0,
  grades text[] not null default '{}',
  hear_about text not null default '',
  message text not null default ''
);

create table if not exists interest_notes (
  id uuid primary key,
  created_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new', 'contacted')),
  name text not null,
  email text not null,
  phone text not null default '',
  page_path text not null default '',
  message text not null default ''
);

create table if not exists tour_bookings (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  tour_date date not null,
  head_count integer not null check (head_count > 0 and head_count <= 20),
  status text not null default 'booked' check (status in ('booked', 'cancelled')),
  created_at timestamptz not null default now()
);

create unique index if not exists tour_bookings_one_active
  on tour_bookings (family_id)
  where status = 'booked';

create table if not exists questions (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  body text not null,
  status text not null default 'new' check (status in ('new', 'replied')),
  created_at timestamptz not null default now()
);

create table if not exists events (
  id uuid primary key,
  title text not null,
  description text not null default '',
  starts_at timestamptz not null,
  location text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists rsvps (
  id uuid primary key,
  event_id uuid not null references events(id) on delete cascade,
  family_id uuid not null references families(id) on delete cascade,
  head_count integer not null check (head_count > 0 and head_count <= 20),
  created_at timestamptz not null default now(),
  unique (event_id, family_id)
);

create table if not exists event_guest_rsvps (
  id uuid primary key,
  event_id uuid not null references events(id) on delete cascade,
  name text not null,
  email text not null,
  head_count integer not null check (head_count between 1 and 20),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- RSVPs aren't capped: a family or guest can bring as many people as they like.
alter table rsvps drop constraint if exists rsvps_head_count_check;
alter table event_guest_rsvps drop constraint if exists event_guest_rsvps_head_count_check;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'rsvps_head_count_positive') then
    alter table rsvps add constraint rsvps_head_count_positive check (head_count > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'event_guest_rsvps_head_count_positive') then
    alter table event_guest_rsvps add constraint event_guest_rsvps_head_count_positive check (head_count > 0);
  end if;
end $$;
create unique index if not exists event_guest_rsvps_email on event_guest_rsvps (event_id, lower(email));

-- Additive: older portal builds can continue writing their original columns.
alter table rsvps add column if not exists note text not null default '';
alter table rsvps add column if not exists updated_at timestamptz not null default now();
alter table email_tokens add column if not exists return_path text not null default '';

create table if not exists activity (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  kind text not null,
  summary text not null
);

alter table families add column if not exists roles text[] not null default '{prospect}';
alter table families add column if not exists first_name text not null default '';
alter table families add column if not exists last_name text not null default '';
alter table families add column if not exists google_sub text;
alter table families alter column password_hash drop not null;

create table if not exists auth_attempts (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  kind text not null,
  key text not null
);

create table if not exists updates_list (
  email text primary key,
  created_at timestamptz not null default now(),
  source text not null default ''
);

create table if not exists time_requests (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  note text not null,
  head_count integer not null default 1,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

create table if not exists students (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  grade text not null default '',
  teacher text not null default ''
);

create table if not exists announcements (
  id uuid primary key,
  title text not null,
  body text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists tour_slots (
  id uuid primary key,
  slot_date date not null,
  start_time text not null,
  end_time text not null,
  capacity integer not null default 1 check (capacity >= 1 and capacity <= 20),
  created_at timestamptz not null default now(),
  unique (slot_date, start_time, end_time)
);

create table if not exists tour_holds (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  slot_id uuid references tour_slots(id) on delete set null,
  kind text not null check (kind in ('slot', 'other')),
  status text not null default 'new' check (status in ('new', 'contacted', 'confirmed', 'cancelled')),
  family_name text not null default '',
  email text not null default '',
  phone text not null default '',
  grades text[] not null default '{}',
  note text not null default '',
  other_time text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists inquiries (
  id uuid primary key,
  created_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new', 'contacted', 'confirmed', 'cancelled')),
  email text not null,
  name text not null default '',
  phone text not null default '',
  grades text[] not null default '{}',
  message text not null default '',
  source text not null default ''
);

alter table inquiries add column if not exists details jsonb not null default '{}';
alter table inquiries add column if not exists autoreply_sent_at timestamptz;

create table if not exists family_emails (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  email text not null unique,
  is_primary boolean not null default false,
  verified_at timestamptz,
  password_hash text,
  google_sub text,
  created_at timestamptz not null default now()
);

create unique index if not exists family_emails_one_primary
  on family_emails (family_id) where is_primary;
-- Staff, admin and developer access belong to the person (their sign-in email),
-- not the household. A family's stage (prospective, enrolled…) is derived from data.
alter table family_emails add column if not exists roles text[] not null default '{}';

create unique index if not exists family_emails_google
  on family_emails (google_sub) where google_sub is not null;

create table if not exists email_codes (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  used_at timestamptz
);

create table if not exists notification_routes (
  family_id uuid not null references families(id) on delete cascade,
  category text not null,
  email text not null,
  primary key (family_id, category)
);
-- Several recipients per kind of message. Rows marked is_default were created
-- automatically at sign-up; with only those, messages go to every guardian.
alter table notification_routes add column if not exists is_default boolean not null default false;
alter table notification_routes drop constraint if exists notification_routes_pkey;
create unique index if not exists notification_routes_one on notification_routes (family_id, category, email);
do $$ begin
  if not exists (select 1 from settings where key = 'notification_routes_defaults_v1') then
    update notification_routes r set is_default = true from families f where f.id = r.family_id and lower(r.email) = lower(f.email);
    insert into settings (key, value) values ('notification_routes_defaults_v1', 'true'::jsonb);
  end if;
end $$;

alter table families add column if not exists last_sign_in_at timestamptz;
alter table families add column if not exists password_changed_at timestamptz;
alter table families add column if not exists family_note text not null default '';
alter table families add column if not exists staff_note text not null default '';
-- Household display name ("The Brooks family"); blank means use the account holder's name.
alter table families add column if not exists household_name text not null default '';
-- A family merged into another keeps its row for audit; reads follow merged_into_id.
alter table families add column if not exists merged_into_id uuid references families(id) on delete set null;
-- One activity log per family: staff notes, merges, join requests.
create table if not exists family_activity (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  at timestamptz not null default now(),
  by text not null default '',
  kind text not null check (kind in ('note', 'merged', 'joined', 'request')),
  note text not null default ''
);
create index if not exists family_activity_family_at on family_activity (family_id, at desc);
-- The old single staff note becomes the first entry of the log, once.
insert into family_activity (id, family_id, at, by, kind, note)
  select gen_random_uuid(), f.id, f.created_at, 'Staff note', 'note', f.staff_note from families f
  where f.staff_note <> '' and not exists (select 1 from family_activity a where a.family_id = f.id and a.by = 'Staff note');
-- "Join my family" requests. from_family merges into to_family once the side that
-- did not start the request approves (initiated_by says which side started it).
create table if not exists family_join_requests (
  id uuid primary key,
  from_family_id uuid not null references families(id) on delete cascade,
  to_family_id uuid not null references families(id) on delete cascade,
  initiated_by text not null check (initiated_by in ('from', 'to')),
  target_email text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text not null default ''
);
-- People in a family (guardians). Each sign-in email belongs to one person.
create table if not exists family_people (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists family_people_family on family_people (family_id);
alter table family_emails add column if not exists person_id uuid references family_people(id) on delete set null;
-- Applications: one per family (or email) per school year. Formaloo and the
-- portal interview form feed it; staff move it through review.
create table if not exists applications (
  id uuid primary key,
  family_id uuid references families(id) on delete set null,
  email text not null default '',
  name text not null default '',
  school_year text not null default '',
  status text not null default 'submitted' check (status in ('submitted', 'reviewing', 'interview', 'accepted', 'waitlisted', 'declined', 'withdrawn')),
  status_by_staff boolean not null default false,
  students jsonb not null default '[]',
  answers jsonb not null default '{}',
  source text not null default 'portal',
  external_id text,
  inquiry_id uuid,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists applications_inquiry on applications (inquiry_id) where inquiry_id is not null;
create index if not exists applications_year on applications (school_year);
-- One application per child (siblings from one submission share group_id).
alter table applications add column if not exists child_id uuid;
alter table applications add column if not exists child_name text not null default '';
alter table applications add column if not exists grade text not null default '';
alter table applications add column if not exists group_id uuid;
alter table applications add column if not exists decided_at timestamptz;
alter table applications add column if not exists decided_by text not null default '';
alter table applications drop constraint if exists applications_status_check;
update applications set status = case status when 'submitted' then 'requested' when 'reviewing' then 'interview' else status end where status in ('submitted', 'reviewing');
alter table applications alter column status set default 'requested';
-- One application per family per year now (applications_per_family_v1 in the
-- migrations merges the older per-child rows and adds the stage check and index).
alter table applications drop constraint if exists applications_stage_check;
alter table applications add column if not exists students_edited boolean not null default false;
drop index if exists applications_inquiry;
-- One application per family, ever. Later interview requests from the family fold
-- into it (inquiry_ids); children are unioned by name and the stage furthest
-- along wins. Used by the migration, the interview sync and family merges.
alter table applications add column if not exists inquiry_ids uuid[] not null default '{}';
create or replace function merge_applications(keep_id uuid, drop_id uuid) returns void language plpgsql as $$
declare k applications%rowtype; d applications%rowtype; stages text[] := array['withdrawn', 'declined', 'requested', 'interview', 'approved', 'application_submitted'];
begin
  select * into k from applications where id = keep_id;
  select * into d from applications where id = drop_id;
  if k.id is null or d.id is null or keep_id = drop_id then return; end if;
  update applications set
    students = coalesce(k.students, '[]'::jsonb) || coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(d.students, '[]'::jsonb)) x
      where x->>'name' <> '' and not exists (select 1 from jsonb_array_elements(coalesce(k.students, '[]'::jsonb)) y where lower(y->>'name') = lower(x->>'name'))), '[]'::jsonb),
    inquiry_ids = array(select distinct i from unnest(k.inquiry_ids || d.inquiry_ids || array_remove(array[d.inquiry_id], null)) i where i is distinct from k.inquiry_id),
    status = case when coalesce(array_position(stages, d.status), 0) > coalesce(array_position(stages, k.status), 0) then d.status else k.status end,
    status_by_staff = k.status_by_staff or d.status_by_staff,
    students_edited = k.students_edited or d.students_edited,
    school_year = case when d.school_year <> '' and d.school_year < k.school_year then d.school_year else k.school_year end,
    submitted_at = least(k.submitted_at, d.submitted_at),
    family_id = coalesce(k.family_id, d.family_id),
    updated_at = now()
  where id = keep_id;
  delete from applications where id = drop_id;
end $$;
-- Children: one record per child from first inquiry to graduation. Rows from the
-- older students and prospect_children tables are copied in once (same ids, so
-- form assignments keep pointing at the right child); those tables are no longer
-- written.
create table if not exists children (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  kind text not null default 'prospective' check (kind in ('student', 'prospective')),
  name text not null default '',
  grade text not null default '',
  teacher text not null default '',
  school_year text not null default '',
  birth_date date,
  current_school text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists children_family on children (family_id, position, name);
-- applications.child_id is declared above (before this table existed); its foreign key is added here.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'applications_child_id_fkey') then
    alter table applications add constraint applications_child_id_fkey foreign key (child_id) references children(id) on delete set null;
  end if;
end $$;
-- School year ('2026–27') for a date; the year turns over on August 1 in Chicago.
create or replace function school_year_of(day date) returns text language sql immutable as $$
  select (case when extract(month from day) >= 8 then extract(year from day)::int else extract(year from day)::int - 1 end)::text
    || '–' || right(((case when extract(month from day) >= 8 then extract(year from day)::int else extract(year from day)::int - 1 end) + 1)::text, 2)
$$;
-- Enrollments: a child in a school year. The source of truth for "enrolled";
-- next year's re-enrollment is a pending row.
create table if not exists enrollments (
  id uuid primary key,
  child_id uuid not null references children(id) on delete cascade,
  school_year text not null,
  grade text not null default '',
  status text not null default 'enrolled' check (status in ('pending', 'enrolled', 'withdrawn', 'graduated')),
  contract_signed_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (child_id, school_year)
);
-- A child can wait for a seat in a full grade while siblings enroll.
alter table enrollments drop constraint if exists enrollments_status_check;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'enrollments_status_v2') then
    alter table enrollments add constraint enrollments_status_v2 check (status in ('pending', 'enrolled', 'waitlisted', 'withdrawn', 'graduated'));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from settings where key = 'enrollments_backfill_v1') then
    insert into enrollments (id, child_id, school_year, grade, status)
      select gen_random_uuid(), c.id, school_year_of((now() at time zone 'America/Chicago')::date), c.grade, 'enrolled' from children c where c.kind = 'student'
      on conflict (child_id, school_year) do nothing;
    insert into settings (key, value) values ('enrollments_backfill_v1', 'true'::jsonb);
  end if;
end $$;
-- Staff-only notes on an application: interview notes, pastoral reference.
alter table applications add column if not exists staff_notes text not null default '';
alter table applications add column if not exists reference jsonb not null default '{}';
create unique index if not exists family_join_requests_open on family_join_requests (from_family_id, to_family_id) where status = 'pending';
alter table email_tokens add column if not exists email text not null default '';
create table if not exists schedule_series (
  id uuid primary key,
  slot_type text not null default 'tour',
  weekdays int[] not null,
  start_time text not null,
  end_time text not null,
  starts_on date not null,
  ends_on date not null,
  capacity int not null default 1,
  capacity_unit text not null default 'families',
  published boolean not null default false,
  skip_dates date[] not null default '{}',
  booking_window_days integer,
  created_at timestamptz not null default now()
);
alter table tour_slots add column if not exists capacity_unit text not null default 'people';
alter table tour_slots add column if not exists series_id uuid references schedule_series(id) on delete set null;
create index if not exists tour_slots_series_date on tour_slots (series_id, slot_date);
-- Repeat frequency: every N weeks on the chosen weekdays, or monthly on the
-- nth (1–4, or 5 for last) chosen weekday. series_hits is the one rule both
-- generation and edits use.
alter table schedule_series add column if not exists repeat_every integer not null default 1;
alter table schedule_series add column if not exists month_week smallint;
create or replace function series_hits(weekdays int[], every int, month_week smallint, starts date, day date) returns boolean language sql immutable as $$
  select extract(dow from day)::int = any(weekdays) and case
    when month_week is null then ((day - (starts - extract(dow from starts)::int)) / 7) % greatest(every, 1) = 0
    when month_week = 5 then extract(month from day + 7) <> extract(month from day)
    else ceil(extract(day from day) / 7.0)::int = month_week end
$$;

alter table tour_slots add column if not exists slot_type text not null default 'tour';
alter table tour_slots add column if not exists published boolean not null default true;
alter table tour_holds add column if not exists head_count integer not null default 1;
alter table tour_holds add column if not exists days text[] not null default '{}';
alter table tour_holds add column if not exists day_parts text[] not null default '{}';
alter table tour_holds add column if not exists earliest_date date;
alter table tour_holds add column if not exists proposed_date date;
alter table tour_holds add column if not exists proposed_start text not null default '';
alter table tour_holds add column if not exists proposed_end text not null default '';
alter table tour_holds add column if not exists reply_message text not null default '';
alter table announcements add column if not exists audience text not null default 'all';
alter table announcements add column if not exists status text not null default 'sent';
alter table announcements add column if not exists emailed boolean not null default false;
alter table announcements add column if not exists sent_at timestamptz;
-- Delivery: in the portal, by email, or both (email-only for one-time notices and newsletters).
alter table announcements add column if not exists in_portal boolean not null default true;
alter table announcements add column if not exists mailed integer not null default 0;
-- Letters can be signed by anyone: a closing line and a signer (a person, the board…).
alter table announcements add column if not exists sign_off text not null default 'Warmly,';
alter table announcements add column if not exists signed_by text not null default 'Trinity Classical Academy';
alter table family_emails add column if not exists label text not null default '';

alter table events add column if not exists ends_at timestamptz;
alter table events add column if not exists show_on_website boolean not null default false;
alter table events add column if not exists feature_popup boolean not null default false;
alter table events add column if not exists collect_rsvp boolean not null default false;
alter table events add column if not exists rsvp_url text not null default '';
alter table events add column if not exists flyer_key text not null default '';
alter table events add column if not exists flyer_name text not null default '';
-- A photo shown beside the event on the family Events page (bytes in the flyer store).
alter table events add column if not exists image_key text not null default '';
-- Calendar items: an event is a Gathering or a School day; who sees it is its
-- audience (public, prospective, enrolled, staff). show_on_website mirrors 'public'.
alter table events add column if not exists type text not null default 'gathering';
alter table events add column if not exists audience text[] not null default '{prospective,enrolled}';
alter table events add column if not exists all_day boolean not null default false;
alter table events add column if not exists capacity integer;
do $$ begin
  if not exists (select 1 from settings where key = 'events_audience_v1') then
    update events set audience = case when show_on_website then '{public,prospective,enrolled}'::text[] else '{prospective,enrolled}'::text[] end;
    insert into settings (key, value) values ('events_audience_v1', 'true'::jsonb);
  end if;
end $$;

create table if not exists school_documents (
  id uuid primary key,
  title text not null,
  category text not null default 'Letters',
  audience text not null default 'everyone',
  grade text not null default '',
  family_id uuid references families(id) on delete cascade,
  status text not null default 'draft',
  file_key text not null default '',
  file_name text not null default '',
  content_type text not null default '',
  file_size integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists school_forms (
  id uuid primary key,
  title text not null,
  instructions text not null default '',
  audience text not null default 'everyone',
  grade text not null default '',
  due_on date,
  status text not null default 'draft',
  questions jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists form_assignments (
  id uuid primary key,
  form_id uuid not null references school_forms(id) on delete cascade,
  family_id uuid not null references families(id) on delete cascade,
  student_id uuid references students(id) on delete cascade,
  status text not null default 'missing',
  answers jsonb not null default '{}',
  signature_name text not null default '',
  signed_at timestamptz,
  submitted_at timestamptz,
  reminded_at timestamptz,
  unique (form_id, family_id, student_id)
);
-- What a form is for. Re-enrollment forms are sent from the Re-enrollment page and
-- link each assignment to the child's next-year enrollment.
alter table school_forms add column if not exists purpose text not null default 'general';
-- A family's full application is a form assignment linked to its application.
alter table form_assignments add column if not exists application_id uuid;
alter table form_assignments add column if not exists enrollment_id uuid references enrollments(id) on delete set null;

create table if not exists prospect_children (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  first_name text not null,
  grade text not null default '',
  school_year text not null default '',
  position integer not null default 0
);

create table if not exists classreach_events (
  classreach_id text primary key,
  title text not null default '',
  starts_on text not null default '',
  ends_on text not null default '',
  payload jsonb not null,
  approval text not null default 'pending' check (approval in ('pending', 'approved')),
  synced_at timestamptz not null default now()
);

create table if not exists classreach_families (
  classreach_id text primary key,
  directory_id text not null default '',
  directory_name text not null default '',
  email text not null default '',
  full_name text not null default '',
  family_id uuid references families(id) on delete set null,
  payload jsonb not null,
  approval text not null default 'pending' check (approval in ('pending', 'approved')),
  synced_at timestamptz not null default now()
);

create table if not exists classreach_students (
  classreach_id text primary key,
  directory_id text not null default '',
  directory_name text not null default '',
  email text not null default '',
  full_name text not null default '',
  family_id uuid references families(id) on delete set null,
  payload jsonb not null,
  approval text not null default 'pending' check (approval in ('pending', 'approved')),
  synced_at timestamptz not null default now()
);

create table if not exists classreach_guardians (
  classreach_id text primary key,
  directory_id text not null default '',
  directory_name text not null default '',
  email text not null default '',
  full_name text not null default '',
  family_id uuid references families(id) on delete set null,
  payload jsonb not null,
  approval text not null default 'pending' check (approval in ('pending', 'approved')),
  synced_at timestamptz not null default now()
);

create table if not exists classreach_sessions (
  id text primary key,
  cookies jsonb not null,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists classreach_alerts (
  id text primary key,
  status text not null,
  reason text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists classreach_sync_runs (
  id uuid primary key,
  status text not null check (status in ('running', 'ok', 'failed', 'skipped')),
  detail text not null default '',
  events_upserted integer not null default 0,
  people_upserted integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Query indexes; existing primary/unique keys already cover email lookups.
create index if not exists family_emails_family_id on family_emails (family_id);
create index if not exists auth_attempts_lookup on auth_attempts (kind, key, created_at);
create index if not exists tour_holds_family_created on tour_holds (family_id, created_at desc) where status <> 'cancelled';
create index if not exists tour_holds_active_slot on tour_holds (slot_id, family_id) where kind = 'slot' and status <> 'cancelled';
create index if not exists tour_holds_created on tour_holds (created_at desc);
create index if not exists tour_requests_created on tour_requests (created_at desc);
create index if not exists tour_requests_active_date on tour_requests (tour_date) where status <> 'cancelled';
create index if not exists tour_bookings_active_date on tour_bookings (tour_date) where status = 'booked';
create index if not exists activity_created on activity (created_at desc);
create index if not exists form_assignments_family on form_assignments (family_id);
create index if not exists email_tokens_live_hash on email_tokens (token_hash, purpose) where used_at is null;
create index if not exists email_codes_family_email on email_codes (family_id, email);
create index if not exists events_starts on events (starts_at);


-- ---------- Classroom: terms, classes, courses, attendance, messages, assignments, grades ----------
-- Terms: the quarters of a school year (report cards are per term).
-- What an interview request was last synced into its application from (so page views skip unchanged ones).
alter table inquiries add column if not exists application_sync text;

-- A 7th or 8th grader's own sign-in: on the family's account, but it opens only that student's pages.
alter table family_emails add column if not exists child_id uuid references children(id) on delete cascade;

create table if not exists school_terms (
  id uuid primary key,
  school_year text not null,
  name text not null,
  starts_on date not null,
  ends_on date not null,
  position integer not null default 0,
  unique (school_year, name)
);
-- Classes: a homeroom (one per grade in K-6) or a section (7-8), with a teacher.
create table if not exists classes (
  id uuid primary key,
  school_year text not null,
  name text not null,
  grade text not null default '',
  kind text not null default 'homeroom' check (kind in ('homeroom', 'section')),
  teacher_email text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists class_students (
  class_id uuid not null references classes(id) on delete cascade,
  child_id uuid not null references children(id) on delete cascade,
  primary key (class_id, child_id)
);
-- Courses: a subject taught to a class (its own teacher, grading kind and category weights).
create table if not exists courses (
  id uuid primary key,
  class_id uuid not null references classes(id) on delete cascade,
  subject text not null,
  teacher_email text not null default '',
  grading text not null default 'letter' check (grading in ('letter', 'mark')),
  weights jsonb not null default '{"Tests":40,"Quizzes":25,"Homework":20,"Projects":15}',
  position integer not null default 0
);
-- Daily attendance, by the homeroom teacher (or reported ahead by the family).
create table if not exists attendance (
  child_id uuid not null references children(id) on delete cascade,
  day date not null,
  status text not null check (status in ('present', 'absent', 'tardy', 'excused', 'early')),
  note text not null default '',
  reported_by text not null default '',
  updated_at timestamptz not null default now(),
  primary key (child_id, day)
);
-- "Left early" (early dismissal) joined the statuses after the table existed.
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'attendance_status_check' and pg_get_constraintdef(oid) not like '%early%') then
    alter table attendance drop constraint attendance_status_check;
    alter table attendance add constraint attendance_status_check check (status in ('present', 'absent', 'tardy', 'excused', 'early'));
  end if;
end $$;
-- Messages: one conversation per student between the family and the school.
create table if not exists message_threads (
  id uuid primary key,
  child_id uuid not null references children(id) on delete cascade,
  family_id uuid not null references families(id) on delete cascade,
  subject text not null default '',
  last_at timestamptz not null default now(),
  unique (child_id)
);
create table if not exists messages (
  id uuid primary key,
  thread_id uuid not null references message_threads(id) on delete cascade,
  author_email text not null,
  author_name text not null default '',
  from_family boolean not null default false,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists messages_thread on messages (thread_id, created_at);
-- Who a family's message was for (a 7th–8th grade subject teacher, say), whether a student wrote it,
-- and whether it went to the whole class.
alter table messages add column if not exists to_email text not null default '';
alter table messages add column if not exists from_student boolean not null default false;
alter table messages add column if not exists class_id uuid references classes(id) on delete set null;
create table if not exists message_reads (
  thread_id uuid not null references message_threads(id) on delete cascade,
  reader text not null,
  read_at timestamptz not null default now(),
  primary key (thread_id, reader)
);
-- Conversations beyond a student's: direct (two participants, dm_key is their sorted
-- keys "a|b", where a key is a sign-in email or family:<id>) and group (group_key is
-- auto:<name> for a group made from roles and classes, group:<id> for a custom one).
alter table message_threads add column if not exists kind text not null default 'student';
alter table message_threads alter column child_id drop not null;
alter table message_threads alter column family_id drop not null;
alter table message_threads add column if not exists dm_key text;
alter table message_threads add column if not exists group_key text;
create unique index if not exists message_threads_dm on message_threads (dm_key) where dm_key is not null;
create unique index if not exists message_threads_group on message_threads (group_key) where group_key is not null;
-- Which announcements each person has opened (by sign-in email). Only letters sent after
-- this shipped count as unread, so families don't start with a pile of "new" ones.
create table if not exists announcement_reads (
  announcement_id uuid not null references announcements(id) on delete cascade,
  reader text not null,
  read_at timestamptz not null default now(),
  primary key (announcement_id, reader)
);
insert into settings (key, value) values ('announcement_reads_since', to_jsonb(now()::text)) on conflict (key) do nothing;
-- Every email the portal tried to send: what, to whom, and whether it went (sent,
-- or why not: turned off, a duplicate, no email service, rejected). Read in Developer → Emails.
create table if not exists email_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  template text not null default '',
  recipient text not null,
  subject text not null,
  fingerprint text not null default '',
  delivered boolean not null default false,
  reason text not null default ''
);
create index if not exists email_log_recent on email_log (at desc);
create index if not exists email_log_dedupe on email_log (recipient, fingerprint, at desc);
-- Custom message groups (Ed Council, room parents): any signed-in person, by email.
create table if not exists chat_groups (
  id uuid primary key,
  name text not null,
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists chat_group_members (
  group_id uuid not null references chat_groups(id) on delete cascade,
  email text not null,
  primary key (group_id, email)
);
-- Assignments and scores.
create table if not exists assignments (
  id uuid primary key,
  course_id uuid not null references courses(id) on delete cascade,
  title text not null,
  category text not null default 'Homework',
  description text not null default '',
  due_on date,
  points numeric,
  graded boolean not null default true,
  published boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists assignments_course_due on assignments (course_id, due_on);
create table if not exists scores (
  assignment_id uuid not null references assignments(id) on delete cascade,
  child_id uuid not null references children(id) on delete cascade,
  points numeric,
  mark text not null default '',
  excused boolean not null default false,
  comment text not null default '',
  updated_at timestamptz not null default now(),
  primary key (assignment_id, child_id)
);
-- Missing work counts as zero until it's turned in; families get an email when work is marked missing.
alter table scores add column if not exists missing boolean not null default false;
-- One email per course and quarter when a student's grade falls below C-; cleared when it recovers.
create table if not exists grade_alerts (
  course_id uuid not null references courses(id) on delete cascade,
  child_id uuid not null references children(id) on delete cascade,
  term_id uuid not null references school_terms(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (course_id, child_id, term_id)
);
-- Report cards: per child per term; comments and conduct are written by teachers,
-- grades are captured when the term's report cards are released (the transcript record).
create table if not exists report_cards (
  id uuid primary key,
  term_id uuid not null references school_terms(id) on delete cascade,
  child_id uuid not null references children(id) on delete cascade,
  comments jsonb not null default '{}',
  general_comment text not null default '',
  conduct text not null default '',
  grades jsonb not null default '[]',
  released_at timestamptz,
  unique (term_id, child_id)
);
-- What families see is the version captured at release; teachers' later edits wait for the next release.
alter table report_cards add column if not exists released_comment text;
alter table report_cards add column if not exists released_conduct text;

-- Children replaced the older students and prospect_children tables: copy them once, and point
-- form assignments at children. Last, so every table it touches exists on a fresh database.
do $$ begin
  if not exists (select 1 from settings where key = 'children_copy_v1') then
    -- A fresh database has neither older table yet (and nothing to copy).
    if to_regclass('students') is not null then
      execute 'insert into children (id, family_id, kind, name, grade, teacher) select id, family_id, ''student'', name, grade, teacher from students on conflict (id) do nothing';
    end if;
    if to_regclass('prospect_children') is not null then
      execute 'insert into children (id, family_id, kind, name, grade, school_year, position) select id, family_id, ''prospective'', first_name, grade, school_year, position from prospect_children on conflict (id) do nothing';
    end if;
    insert into settings (key, value) values ('children_copy_v1', 'true'::jsonb);
  end if;
  alter table form_assignments drop constraint if exists form_assignments_student_id_fkey;
  if not exists (select 1 from pg_constraint where conname = 'form_assignments_child_fk') then
    alter table form_assignments add constraint form_assignments_child_fk foreign key (student_id) references children(id) on delete cascade;
  end if;
end $$;
`;

/** A permanent marker means staff edits and deletions survive later bootstraps. */
export const INFO_NIGHT_ID = 'ec99c6a0-30da-4b66-8ccb-777c05360f4b';
export const INFO_NIGHT_SEED_SQL = `
do $$
begin
  if not exists (select 1 from settings where key = 'seed:info-night-2027-01-26') then
    insert into events (id, title, starts_at, ends_at, location, description, show_on_website, feature_popup, collect_rsvp, rsvp_url)
    values ('${INFO_NIGHT_ID}', 'Information & Enrollment Night', '2027-01-26T18:30:00-06:00'::timestamptz,
      '2027-01-26T20:00:00-06:00'::timestamptz,
      'Trinity Presbyterian Church, 7160 Cahaba Valley Rd., Birmingham, AL 35242',
      'Hear from our board, ask questions, and learn about enrolling for the 2027–28 school year. Light refreshments. Everyone is welcome. RSVP is optional and helps us plan.',
      true, true, true, '') on conflict (id) do nothing;
    insert into settings (key, value) values ('seed:info-night-2027-01-26', 'true'::jsonb) on conflict (key) do nothing;
  end if;
end $$;
`;

/** The setting and rule are committed together by dbReady's schema transaction. */
export const TOUR_RULE_SEED_SQL = `
with seed as (
  insert into settings (key, value) values ('tour_rule_seed_v1', 'true'::jsonb)
  on conflict (key) do nothing returning key
)
insert into schedule_series (id, weekdays, start_time, end_time, starts_on, ends_on, booking_window_days)
select gen_random_uuid(), array[3,4], '08:10', '09:00', '2026-12-02'::date, '2027-05-27'::date, 92 from seed;
`;

/** Existing compatibility migrations and backfills; included in the schema version. */
export const MIGRATION_SQL = INFO_NIGHT_SEED_SQL + TOUR_RULE_SEED_SQL + INCOMING_SCHEMA_SQL + `
        do $$ begin
          if current_setting('tca.incoming_writes', true) = 'on' then
            ${INCOMING_BACKFILL_SQL}
            insert into settings(key,value) values('incoming_backfill_v1','true'::jsonb) on conflict(key) do nothing;
          end if;
        end $$;
		do $$
		declare cname text;
		begin
			for cname in
				select con.conname
				from pg_constraint con
				join pg_class rel on rel.oid = con.conrelid
				where rel.relname = 'tour_slots' and con.contype = 'c'
					and pg_get_constraintdef(con.oid) ilike '%capacity%'
			loop
				execute format('alter table tour_slots drop constraint %I', cname);
			end loop;
			alter table tour_slots add constraint tour_slots_capacity_check check (capacity >= 1 and capacity <= 500);
			for cname in
				select con.conname
				from pg_constraint con
				join pg_class rel on rel.oid = con.conrelid
				where rel.relname = 'tour_holds' and con.contype = 'c'
					and pg_get_constraintdef(con.oid) ilike '%status%'
			loop
				execute format('alter table tour_holds drop constraint %I', cname);
			end loop;
			alter table tour_holds add constraint tour_holds_status_check check (status in ('new', 'contacted', 'confirmed', 'cancelled', 'proposed'));
		end $$;

		insert into family_emails (id, family_id, email, is_primary, verified_at, password_hash, google_sub)
		select gen_random_uuid(), f.id, lower(f.email), true, f.email_verified_at,
			nullif(f.password_hash, ''), f.google_sub
		from families f
		where f.email <> '' and f.merged_into_id is null
			and not exists (select 1 from family_emails e where e.family_id = f.id)
			and not exists (select 1 from family_emails e where e.email = lower(f.email));

		insert into notification_routes (family_id, category, email, is_default)
		select f.id, c.category, lower(f.email), true
		from families f
		cross join (values ('announcements'), ('tours'), ('admin')) as c(category)
		where f.email <> ''
			and not exists (
				select 1 from notification_routes r
				where r.family_id = f.id and r.category = c.category
			);
		-- Applications are per family: one per interview request, with its children
		-- in students. Siblings' rows merge into the one furthest along; a waitlisted
		-- child keeps that on their enrollment. Single approval after the interview.
		do $$ begin
			if not exists (select 1 from settings where key = 'applications_per_family_v1') then
				insert into enrollments (id, child_id, school_year, grade, status)
					select gen_random_uuid(), child_id, school_year, grade, 'waitlisted' from applications where status = 'waitlisted' and child_id is not null
					on conflict (child_id, school_year) do update set status = 'waitlisted', updated_at = now();
				create temp table app_merge on commit drop as
					select id, coalesce(group_id, id) as grp,
						row_number() over (partition by coalesce(group_id, id) order by array_position(array['withdrawn', 'declined', 'requested', 'interview', 'interviewed', 'application_sent', 'waitlisted', 'application_submitted', 'accepted'], status) desc nulls last, submitted_at) as rank
					from applications;
				create temp table app_kids on commit drop as
					select coalesce(group_id, id) as grp, jsonb_agg(jsonb_build_object('name', child_name, 'grade', grade, 'currentSchool', coalesce(students->0->>'currentSchool', ''), 'childId', child_id) order by child_name) filter (where child_name <> '') as list
					from applications group by 1;
				update applications a set students = coalesce(k.list, a.students), group_id = m.grp
					from app_merge m join app_kids k on k.grp = m.grp where a.id = m.id and m.rank = 1;
				delete from applications a using app_merge m where a.id = m.id and m.rank > 1;
				update applications set status = case status when 'interviewed' then 'interview' when 'application_sent' then 'approved'
					when 'accepted' then 'application_submitted' when 'waitlisted' then 'application_submitted' else status end;
				drop index if exists applications_inquiry_child;
				create unique index if not exists applications_inquiry_family on applications (inquiry_id) where inquiry_id is not null;
				alter table applications add constraint applications_family_stage_check check (status in ('requested', 'interview', 'approved', 'application_submitted', 'declined', 'withdrawn'));
				insert into settings (key, value) values ('applications_per_family_v1', 'true'::jsonb) on conflict (key) do nothing;
			end if;
		end $$;
		-- One application per family (or per email before there's an account).
		do $$ declare grp record; keep uuid; other uuid; begin
			if not exists (select 1 from settings where key = 'applications_one_per_family_v1') then
				update applications a set family_id = f.merged_into_id from families f where f.id = a.family_id and f.merged_into_id is not null;
				for grp in select coalesce(family_id::text, 'e:' || lower(email)) as k from applications group by 1 having count(*) > 1 loop
					select id into keep from applications where coalesce(family_id::text, 'e:' || lower(email)) = grp.k
						order by array_position(array['withdrawn', 'declined', 'requested', 'interview', 'approved', 'application_submitted'], status) desc nulls last, submitted_at limit 1;
					for other in select id from applications where coalesce(family_id::text, 'e:' || lower(email)) = grp.k and id <> keep loop
						perform merge_applications(keep, other);
					end loop;
				end loop;
				create unique index if not exists applications_one_per_family on applications (family_id) where family_id is not null;
				create unique index if not exists applications_one_per_email on applications (lower(email)) where family_id is null;
				insert into settings (key, value) values ('applications_one_per_family_v1', 'true'::jsonb) on conflict (key) do nothing;
			end if;
		end $$;
		-- Access moves from the household to the person: each family's admin/staff
		-- role goes to its primary sign-in email (other logins can be added later).
		do $$ begin
			if not exists (select 1 from settings where key = 'person_access_v1') then
				update family_emails e set roles = array(select distinct r from unnest(f.roles) r where r in ('admin', 'staff'))
				from families f where f.id = e.family_id and (e.is_primary or lower(f.email) = e.email) and f.roles && array['admin', 'staff']::text[];
				insert into settings (key, value) values ('person_access_v1', 'true'::jsonb) on conflict (key) do nothing;
			end if;
		end $$;
		-- Tours are campus tours only: open houses and info nights are gatherings (events),
		-- and interviews belong to applications. Remove leftover tour times of those kinds
		-- that nobody booked, and the schedules that generated them.
		do $$ begin
			if not exists (select 1 from settings where key = 'tours_campus_only_v1') then
				delete from tour_slots s where s.slot_type in ('open_house', 'info_night', 'interview')
					and not exists (select 1 from tour_holds h where h.slot_id = s.id);
				delete from schedule_series r where r.slot_type in ('open_house', 'info_night', 'interview')
					and not exists (select 1 from tour_slots s where s.series_id = r.id);
				insert into settings (key, value) values ('tours_campus_only_v1', 'true'::jsonb) on conflict (key) do nothing;
			end if;
		end $$;
		-- Requested tours: times staff set up for one family's request used to be saved as
		-- published Campus tours. Mark them private (unpublished) so no one else sees them.
		do $$ begin
			if not exists (select 1 from settings where key = 'private_tours_v1') then
				update tour_slots s set slot_type = 'private_tour', published = false
				where s.series_id is null and s.slot_type = 'tour' and s.capacity = 1 and s.capacity_unit = 'families'
					and exists (select 1 from tour_holds h where h.slot_id = s.id and h.other_time <> '');
				insert into settings (key, value) values ('private_tours_v1', 'true'::jsonb) on conflict (key) do nothing;
			end if;
		end $$;
`;
