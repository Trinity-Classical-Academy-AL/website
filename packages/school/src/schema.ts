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

alter table families add column if not exists last_sign_in_at timestamptz;
alter table families add column if not exists password_changed_at timestamptz;
alter table families add column if not exists family_note text not null default '';
alter table families add column if not exists staff_note text not null default '';
alter table email_tokens add column if not exists email text not null default '';
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
alter table family_emails add column if not exists label text not null default '';

alter table events add column if not exists ends_at timestamptz;
alter table events add column if not exists show_on_website boolean not null default false;
alter table events add column if not exists feature_popup boolean not null default false;
alter table events add column if not exists collect_rsvp boolean not null default false;
alter table events add column if not exists rsvp_url text not null default '';
alter table events add column if not exists flyer_key text not null default '';
alter table events add column if not exists flyer_name text not null default '';

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
`;
