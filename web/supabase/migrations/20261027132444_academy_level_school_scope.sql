-- Add school-level scope to academy-managed student levels.
-- Existing rows remain nullable so legacy level names are preserved until an
-- operator classifies them. New level rows are required to provide a scope
-- through the admin API.

alter table public.academy_levels
  add column if not exists school_level text;

alter table public.academy_levels
  add constraint academy_levels_school_level_check
  check (school_level is null or school_level in ('elementary', 'middle', 'high'));

-- Allow the same display name (for example, "기초") once per school level,
-- while keeping legacy/unclassified names unique within an academy.
alter table public.academy_levels
  drop constraint if exists academy_levels_academy_id_name_key;

create unique index if not exists academy_levels_academy_scoped_name_key
  on public.academy_levels (academy_id, school_level, name)
  where school_level is not null;

create unique index if not exists academy_levels_academy_unclassified_name_key
  on public.academy_levels (academy_id, name)
  where school_level is null;

create index if not exists academy_levels_school_scope_lookup_idx
  on public.academy_levels (academy_id, school_level, is_active, display_order, name);
