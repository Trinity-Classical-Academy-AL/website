// Budget (proforma) tables. Owned by the budget workstream; appended to MIGRATION_SQL via finance/schema.ts.
// Money is integer cents (bigint), rates are basis points (2% = 200). Idempotent.
export const BUDGET_SCHEMA_SQL = `
create table if not exists budget_scenarios (
  id uuid primary key,
  name text not null,
  school_year text not null,
  notes text not null default '',
  is_primary boolean not null default false,
  church_donation_cents bigint not null default 0,
  sub_rate_bps integer not null default 150,
  payroll_tax_bps integer not null default 800,
  medical_cents bigint not null default 0,
  retirement_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists budget_scenarios_name_key on budget_scenarios (lower(name));
-- One primary budget per school year.
create unique index if not exists budget_scenarios_primary_key on budget_scenarios (school_year) where is_primary;

create table if not exists budget_tiers (
  id uuid primary key,
  scenario_id uuid not null references budget_scenarios(id) on delete cascade,
  label text not null,
  tuition_cents bigint not null default 0,
  students integer not null default 0,
  position integer not null default 0
);
create index if not exists budget_tiers_scenario_idx on budget_tiers (scenario_id, position);

create table if not exists budget_fees (
  id uuid primary key,
  scenario_id uuid not null references budget_scenarios(id) on delete cascade,
  label text not null,
  amount_cents bigint not null default 0,
  -- null charges every student (the census).
  students integer,
  position integer not null default 0
);
create index if not exists budget_fees_scenario_idx on budget_fees (scenario_id, position);

create table if not exists budget_staff (
  id uuid primary key,
  scenario_id uuid not null references budget_scenarios(id) on delete cascade,
  name text not null,
  staff_group text not null check (staff_group in ('faculty', 'leadership')),
  role text not null default '',
  pay_cents bigint not null default 0,
  on_payroll boolean not null default true,
  position integer not null default 0
);
create index if not exists budget_staff_scenario_idx on budget_staff (scenario_id, position);

create table if not exists budget_lines (
  id uuid primary key,
  scenario_id uuid not null references budget_scenarios(id) on delete cascade,
  section text not null check (section in ('discounts', 'fixed', 'education', 'administrative', 'facility')),
  kind text check (kind in ('faculty', 'family', 'assistance', 'other')),
  label text not null,
  rule text not null check (rule in ('flat', 'per_student', 'per_student_monthly', 'per_faculty', 'pct_gross', 'pct_tuition', 'pct_collected', 'pct_tuition_count')),
  amount_cents bigint not null default 0,
  rate_bps integer not null default 0,
  count integer not null default 0,
  tier_id uuid references budget_tiers(id) on delete set null,
  note text not null default '',
  position integer not null default 0
);
create index if not exists budget_lines_scenario_idx on budget_lines (scenario_id, section, position);
`;
