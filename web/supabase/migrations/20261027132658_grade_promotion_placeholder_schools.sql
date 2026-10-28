-- Mark system placeholder schools used while a student's actual destination
-- school is not known yet at the January promotion date.

alter table public.schools
  add column if not exists is_placeholder boolean not null default false;

create index if not exists schools_academy_placeholder_idx
  on public.schools (academy_id, is_placeholder, school_level, name);
