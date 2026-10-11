-- Academy-managed classrooms and default class schedule information.
create table public.classrooms (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  name text not null check (char_length(trim(name)) between 1 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, name)
);

create index classrooms_lookup_idx
  on public.classrooms (academy_id, is_active, name);

alter table public.students
  add column classroom_id uuid references public.classrooms (id) on delete restrict;

create index students_academy_classroom_idx
  on public.students (academy_id, classroom_id);

alter table public.terms
  add column is_archived boolean not null default false;

update public.terms as term
set is_archived = exists (
  select 1
  from public.terms as current_term
  where current_term.academy_id = term.academy_id
    and current_term.is_current
    and term.end_date < current_term.start_date
);

alter table public.classes
  add column meeting_days text[] not null default '{}',
  add column start_time time,
  add column end_time time,
  add constraint classes_meeting_days_allowed
    check (meeting_days <@ array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']::text[]),
  add constraint classes_schedule_range
    check (
      (start_time is null and end_time is null)
      or (start_time is not null and end_time is not null and start_time < end_time)
    );

create trigger classrooms_set_updated_at
before update on public.classrooms
for each row execute function private.set_updated_at();

alter table public.classrooms enable row level security;

grant select, insert, update on public.classrooms to authenticated;

create policy classrooms_select on public.classrooms
for select to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]));

create policy classrooms_manage on public.classrooms
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));
