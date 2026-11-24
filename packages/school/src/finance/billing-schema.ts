// Billing (rate cards, plans, ledger, books mapping) tables. Owned by the billing workstream; appended via finance/schema.ts.
// Money is integer cents. Ledger amounts are always positive; the entry's kind (and an adjustment's direction) gives the sign.
// Ledger rows are never deleted: a mistake is voided with a reason.
export const BILLING_SCHEMA_SQL = `
-- One official rate card per school year, copied from that year's primary budget scenario when published.
create table if not exists finance_rate_cards (
  id uuid primary key,
  school_year text not null unique,
  scenario_id uuid,
  tiers jsonb not null default '[]'::jsonb,
  fees jsonb not null default '[]'::jsonb,
  published_at timestamptz not null default now(),
  published_by text not null default ''
);
-- A tuition plan: one per child per school year. Tuition and fees are copied from the rate card.
create table if not exists finance_plans (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  child_id uuid references children(id) on delete set null,
  child_name text not null default '',
  school_year text not null,
  tier text not null default '',
  tuition_cents integer not null default 0 check (tuition_cents >= 0),
  schedule text not null default 'ten_month' check (schedule in ('annual', 'semester', 'ten_month', 'twelve_month')),
  first_due_on date,
  fees jsonb not null default '[]'::jsonb,
  discounts jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'active', 'closed')),
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists finance_plans_child_year on finance_plans (child_id, school_year) where child_id is not null;
create index if not exists finance_plans_year on finance_plans (school_year, status);
create index if not exists finance_plans_family on finance_plans (family_id, school_year);
-- The ledger: every charge, credit, payment, refund and adjustment.
create table if not exists finance_entries (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  child_id uuid references children(id) on delete set null,
  plan_id uuid references finance_plans(id) on delete set null,
  school_year text not null,
  kind text not null check (kind in ('charge', 'credit', 'payment', 'refund', 'adjustment')),
  direction text check (direction in ('debit', 'credit')),
  category text not null default '',
  amount_cents integer not null check (amount_cents > 0),
  due_on date,
  posted_on date not null,
  scheduled boolean not null default false,
  memo text not null default '',
  method text check (method in ('check', 'cash', 'transfer', 'other', 'card_online', 'bank_online')),
  reference text not null default '',
  provider text not null default '',
  provider_ref text not null default '',
  books_ref text not null default '',
  exported_at timestamptz,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by text not null default '',
  void_reason text not null default '',
  constraint finance_entries_direction check ((kind = 'adjustment') = (direction is not null))
);
create index if not exists finance_entries_family on finance_entries (family_id, school_year);
create index if not exists finance_entries_plan on finance_entries (plan_id) where plan_id is not null;
create index if not exists finance_entries_posted on finance_entries (posted_on);
-- A processor event lands once: its reference is unique per provider.
create unique index if not exists finance_entries_provider_ref on finance_entries (provider, provider_ref) where provider_ref <> '';
-- QuickBooks account or item name per ledger category.
create table if not exists finance_books_accounts (
  category text primary key,
  account text not null default ''
);
insert into finance_books_accounts (category, account) values
  ('tuition', 'Tuition Income'),
  ('registration', 'Registration Fees'),
  ('enrollment_fee', 'Registration Fees'),
  ('other_fee', 'Registration Fees'),
  ('faculty_discount', 'Tuition Discounts'),
  ('family_discount', 'Tuition Discounts'),
  ('tuition_assistance', 'Financial Aid'),
  ('other_credit', 'Tuition Discounts'),
  ('payment', 'Undeposited Funds')
on conflict (category) do nothing;
`;
