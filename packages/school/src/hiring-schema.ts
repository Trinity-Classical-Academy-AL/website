// Teacher hiring tables (see hiring.ts). No imports: schema.ts reads this at load.
export const HIRING_SCHEMA_SQL = `
create table if not exists teacher_applicants (
  id uuid primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'applied' check (status in ('applied', 'full_application', 'video_lesson', 'board_interview', 'deciding', 'hired', 'declined', 'withdrawn')),
  name text not null,
  email text not null,
  phone text not null default '',
  position text not null default '',
  church text not null default '',
  experience text not null default '',
  statement text not null default '',
  resume_url text not null default '',
  source text not null default 'portal',
  video_with text not null default '',
  video_at timestamptz,
  board_at timestamptz,
  stage_by text not null default ''
);
create index if not exists teacher_applicants_status on teacher_applicants (status, updated_at desc);
-- Shared notes and recommendations; stage changes and emails are logged here too.
create table if not exists teacher_applicant_notes (
  id uuid primary key,
  applicant_id uuid not null references teacher_applicants(id) on delete cascade,
  at timestamptz not null default now(),
  by text not null default '',
  kind text not null default 'note' check (kind in ('note', 'recommendation', 'stage', 'email')),
  recommendation text check (recommendation in ('yes', 'maybe', 'no')),
  note text not null default ''
);
create index if not exists teacher_applicant_notes_applicant on teacher_applicant_notes (applicant_id, at);
-- Candidates apply from their portal account; files are their uploads (CV, cover letter, other).
alter table teacher_applicants add column if not exists family_id uuid references families(id) on delete set null;
alter table teacher_applicants add column if not exists files jsonb not null default '[]';
create index if not exists teacher_applicants_family on teacher_applicants (family_id);
-- The in-portal full application is a form assignment linked to the candidate.
alter table form_assignments add column if not exists teacher_applicant_id uuid references teacher_applicants(id) on delete cascade;
`;
