-- The academy-wide teacher fallback and two-period model are removed.
-- Existing class teacher assignments are intentionally cleared per the new
-- class-only assignment policy. Existing schedule blocks and records remain
-- as historical snapshots.

create table public.academy_operation_schedules (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  weekdays text[] not null,
  start_time time not null,
  end_time time not null,
  is_active boolean not null default true,
  updated_by_profile_id uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(weekdays) > 0),
  check (weekdays <@ array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']::text[]),
  check (start_time < end_time)
);

create index academy_operation_schedules_academy_idx
  on public.academy_operation_schedules (academy_id, is_active, start_time);

create trigger academy_operation_schedules_set_updated_at
before update on public.academy_operation_schedules
for each row execute function private.set_updated_at();

alter table public.academy_operation_schedules enable row level security;

revoke all on table public.academy_operation_schedules from anon, authenticated;
grant select, insert, update on table public.academy_operation_schedules to authenticated;

create policy academy_operation_schedules_admin
on public.academy_operation_schedules
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));

-- Preserve the current common time as an initial weekday schedule before the
-- legacy columns are removed. A later admin edit can split weekdays further.
insert into public.academy_operation_schedules (
  academy_id,
  weekdays,
  start_time,
  end_time,
  updated_by_profile_id
)
select
  settings.academy_id,
  array_agg(distinct weekday order by weekday),
  settings.common_start_time,
  settings.common_end_time,
  settings.updated_by_profile_id
from public.academy_operation_settings settings
join public.classes classes
  on classes.academy_id = settings.academy_id
cross join lateral unnest(classes.meeting_days) as days(weekday)
where classes.is_active
  and settings.common_start_time is not null
  and settings.common_end_time is not null
group by
  settings.academy_id,
  settings.common_start_time,
  settings.common_end_time,
  settings.updated_by_profile_id;

-- Existing classes are deliberately left without a teacher until the
-- administrator assigns both grammar and reading teachers per class.
update public.classes
set grammar_teacher_id = null,
    reading_teacher_id = null,
    updated_at = now();

alter table public.academy_operation_settings
  alter column grammar_subject_id drop not null,
  alter column reading_subject_id drop not null,
  alter column grammar_classroom_id drop not null,
  alter column reading_classroom_id drop not null;

alter table public.academy_operation_settings
  drop column if exists grammar_teacher_id,
  drop column if exists reading_teacher_id,
  drop column if exists common_start_time,
  drop column if exists common_end_time,
  drop column if exists period_minutes,
  drop column if exists break_minutes;
