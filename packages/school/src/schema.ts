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
`;
