/**
 * Schema for the ClassReach directory match (Admin → ClassReach). Append to
 * MIGRATION_SQL. Additive only: a child imported from ClassReach carries its
 * ClassReach id (so a second import finds it instead of adding a twin), and an
 * admin can set a directory entry aside so it stops showing as work to do.
 */
export const CLASSREACH_MATCH_SQL = `
alter table children add column if not exists classreach_id text;
create unique index if not exists children_classreach on children (classreach_id) where classreach_id is not null;
create table if not exists classreach_match_skips (
  kind text not null check (kind in ('guardian', 'family', 'student')),
  classreach_id text not null,
  by text not null default '',
  at timestamptz not null default now(),
  primary key (kind, classreach_id)
);
`;
