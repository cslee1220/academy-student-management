-- Student school options, classification, and normalized guardian phone support.

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  school_level text not null check (school_level in ('elementary', 'middle', 'high')),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, school_level, name)
);

alter table public.students
  add column school_level text check (school_level in ('elementary', 'middle', 'high')),
  add column school_id uuid references public.schools (id) on delete restrict;

create index schools_academy_active_idx on public.schools (academy_id, is_active, school_level, name);
create index students_academy_school_idx on public.students (academy_id, school_id);
create index guardians_academy_phone_idx on public.guardians (academy_id, phone);

create or replace function private.validate_student_school()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  selected_school public.schools%rowtype;
begin
  if new.school_id is null then
    return new;
  end if;

  select * into selected_school
  from public.schools
  where id = new.school_id
    and academy_id = new.academy_id;

  if not found then
    raise exception 'student school must belong to the same academy' using errcode = '23503';
  end if;
  if not selected_school.is_active then
    raise exception 'student school must be active' using errcode = '23503';
  end if;
  if new.school_level is not null and new.school_level <> selected_school.school_level then
    raise exception 'student school level must match school' using errcode = '23514';
  end if;

  new.school_level = selected_school.school_level;
  new.school_name = selected_school.name;
  return new;
end;
$$;

create trigger students_validate_school
before insert or update of academy_id, school_id, school_level, school_name on public.students
for each row execute function private.validate_student_school();

create trigger schools_set_updated_at before update on public.schools
for each row execute function private.set_updated_at();

alter table public.schools enable row level security;

grant select, insert, update on public.schools to authenticated;

create policy schools_select on public.schools
for select to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]));

create policy schools_manage on public.schools
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));
