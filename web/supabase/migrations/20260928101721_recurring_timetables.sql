-- Recurring class schedules used to generate future class sessions.
-- This migration intentionally contains no demo or personal data.

create table public.recurring_timetables (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  class_id uuid not null references public.classes (id) on delete restrict,
  weekday text not null check (weekday in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')),
  start_time time not null,
  end_time time not null,
  effective_start date not null,
  effective_end date not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, class_id, weekday, start_time, effective_start),
  check (start_time < end_time),
  check (effective_start <= effective_end)
);

create or replace function private.validate_recurring_timetable_class()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.classes c
    where c.id = new.class_id
      and c.academy_id = new.academy_id
  ) then
    raise exception 'recurring timetable class must belong to the same academy' using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger recurring_timetables_validate_class
before insert or update of academy_id, class_id on public.recurring_timetables
for each row execute function private.validate_recurring_timetable_class();

create trigger recurring_timetables_set_updated_at
before update on public.recurring_timetables
for each row execute function private.set_updated_at();

create index recurring_timetables_academy_active_idx
  on public.recurring_timetables (academy_id, is_active, class_id, weekday, effective_start);

alter table public.recurring_timetables enable row level security;

revoke all on table public.recurring_timetables from anon, authenticated;
grant select, insert, update on table public.recurring_timetables to authenticated;

create policy recurring_timetables_select on public.recurring_timetables
for select to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]));

create policy recurring_timetables_manage on public.recurring_timetables
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));
