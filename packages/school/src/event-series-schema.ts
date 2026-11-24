// Repeating gatherings and school days (see event-series.ts). No imports: schema.ts reads this at load.
// A rule (the same repeat fields as tour schedules) plus a template; each date is an events row with series_id.
export const EVENT_SERIES_SCHEMA_SQL = `
create table if not exists event_series (
  id uuid primary key,
  weekdays int[] not null,
  repeat_every integer not null default 1,
  month_week smallint,
  starts_on date not null,
  ends_on date not null,
  skip_dates date[] not null default '{}',
  template jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table events add column if not exists series_id uuid references event_series(id) on delete set null;
create index if not exists events_series on events (series_id, starts_at);
-- A date changed on its own leaves its series; this remembers which (so it isn't listed as skipped).
alter table events add column if not exists detached_from uuid;
alter table tour_slots add column if not exists detached_from uuid;
`;
