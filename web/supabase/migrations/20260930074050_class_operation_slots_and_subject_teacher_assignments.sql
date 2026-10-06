-- A class points to one reusable operation time slot. Multiple classes may
-- share the same slot, while a slot may contain several weekdays.
alter table public.classes
  add column operation_schedule_id uuid references public.academy_operation_schedules (id) on delete restrict;

create index classes_operation_schedule_idx
  on public.classes (academy_id, operation_schedule_id);

-- This is the only active source for class-level subject teacher assignment.
-- Missing rows intentionally mean "unassigned"; historical schedule blocks
-- keep their own teacher snapshots and are not changed by this table.
create table public.class_subject_teacher_assignments (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  class_id uuid not null references public.classes (id) on delete restrict,
  subject_id uuid not null references public.subjects (id) on delete restrict,
  teacher_id uuid not null references public.profiles (id) on delete restrict,
  effective_start date not null default current_date,
  effective_end date,
  is_active boolean not null default true,
  updated_by_profile_id uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_end is null or effective_start <= effective_end),
  unique (academy_id, class_id, subject_id, effective_start)
);

create index class_subject_teacher_assignments_active_idx
  on public.class_subject_teacher_assignments (academy_id, class_id, subject_id, is_active);

create trigger class_subject_teacher_assignments_set_updated_at
before update on public.class_subject_teacher_assignments
for each row execute function private.set_updated_at();

create or replace function private.validate_class_subject_teacher_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not exists (
    select 1 from public.classes c
    where c.id = new.class_id and c.academy_id = new.academy_id
  ) then
    raise exception 'class academy mismatch';
  end if;

  if not exists (
    select 1 from public.subjects s
    where s.id = new.subject_id and s.academy_id = new.academy_id
  ) then
    raise exception 'subject academy mismatch';
  end if;

  if not exists (
    select 1 from public.academy_memberships am
    where am.academy_id = new.academy_id
      and am.profile_id = new.teacher_id
      and am.role = 'teacher'
      and am.is_active
  ) then
    raise exception 'teacher must be an active academy teacher';
  end if;

  return new;
end;
$$;

create trigger class_subject_teacher_assignments_validate
before insert or update of academy_id, class_id, subject_id, teacher_id
on public.class_subject_teacher_assignments
for each row execute function private.validate_class_subject_teacher_assignment();

alter table public.class_subject_teacher_assignments enable row level security;

revoke all on table public.class_subject_teacher_assignments from anon, authenticated;
grant select, insert, update on table public.class_subject_teacher_assignments to authenticated;

create policy class_subject_teacher_assignments_admin
on public.class_subject_teacher_assignments
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));

-- Preserve existing class times by linking classes to an exact existing or
-- newly seeded slot. No teacher assignment is inferred here.
insert into public.academy_operation_schedules (
  academy_id,
  weekdays,
  start_time,
  end_time
)
select distinct
  c.academy_id,
  c.meeting_days,
  c.start_time,
  c.end_time
from public.classes c
where c.is_active
  and cardinality(c.meeting_days) > 0
  and c.start_time is not null
  and c.end_time is not null
  and not exists (
    select 1
    from public.academy_operation_schedules s
    where s.academy_id = c.academy_id
      and s.start_time = c.start_time
      and s.end_time = c.end_time
      and s.weekdays @> c.meeting_days
      and c.meeting_days @> s.weekdays
  );

update public.classes c
set operation_schedule_id = (
      select s.id
      from public.academy_operation_schedules s
      where s.academy_id = c.academy_id
        and s.is_active
        and s.start_time = c.start_time
        and s.end_time = c.end_time
        and s.weekdays @> c.meeting_days
        and c.meeting_days @> s.weekdays
      order by s.created_at asc
      limit 1
    ),
    updated_at = now()
where c.operation_schedule_id is null
  and exists (
    select 1
    from public.academy_operation_schedules s
    where s.academy_id = c.academy_id
      and s.is_active
      and s.start_time = c.start_time
      and s.end_time = c.end_time
      and s.weekdays @> c.meeting_days
      and c.meeting_days @> s.weekdays
  );

-- The previous two-column mapping is no longer a source of truth. Existing
-- values were already cleared by the preceding migration.
drop trigger if exists classes_validate_teacher_mapping on public.classes;
drop index if exists public.classes_teacher_mapping_idx;
alter table public.classes
  drop constraint if exists classes_teacher_mapping_complete,
  drop column if exists grammar_teacher_id,
  drop column if exists reading_teacher_id;
drop function if exists private.validate_class_teacher_mapping();
