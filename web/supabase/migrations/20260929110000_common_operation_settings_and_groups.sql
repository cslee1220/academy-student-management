create table public.academy_operation_settings (
  academy_id uuid primary key references public.academies (id) on delete restrict,
  grammar_subject_id uuid not null references public.subjects (id) on delete restrict,
  reading_subject_id uuid not null references public.subjects (id) on delete restrict,
  grammar_teacher_id uuid not null references public.profiles (id) on delete restrict,
  reading_teacher_id uuid not null references public.profiles (id) on delete restrict,
  grammar_classroom_id uuid not null references public.classrooms (id) on delete restrict,
  reading_classroom_id uuid not null references public.classrooms (id) on delete restrict,
  common_start_time time not null,
  common_end_time time not null,
  period_minutes integer not null default 60 check (period_minutes between 1 and 720),
  break_minutes integer not null default 0 check (break_minutes between 0 and 240),
  updated_by_profile_id uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (common_start_time < common_end_time)
);

alter table public.class_schedule_block_students
  add column operation_group text check (operation_group in ('A', 'B'));

create index class_schedule_block_students_group_idx
  on public.class_schedule_block_students (academy_id, operation_group, is_active);

create trigger academy_operation_settings_set_updated_at
before update on public.academy_operation_settings
for each row execute function private.set_updated_at();

alter table public.academy_operation_settings enable row level security;

revoke all on table public.academy_operation_settings from anon, authenticated;
grant select, insert, update on table public.academy_operation_settings to authenticated;

create policy academy_operation_settings_admin
on public.academy_operation_settings
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));
