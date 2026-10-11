-- Student-level first class start date and student-specific supplementary tasks.
-- Existing daily records and the generic is_supplementary flag remain intact.

alter table public.students
  add column if not exists class_start_date date;

update public.students s
set class_start_date = coalesce(
  (
    select min(a.start_date)
    from public.student_class_assignments a
    where a.academy_id = s.academy_id
      and a.student_id = s.id
  ),
  s.registered_at
)
where s.class_start_date is null;

create index if not exists students_academy_class_start_date_idx
  on public.students (academy_id, class_start_date);

alter table public.daily_subject_records
  add column if not exists is_test_supplementary boolean not null default false,
  add column if not exists is_homework_supplementary boolean not null default false,
  add column if not exists homework_supplement_content text;

create table if not exists public.student_supplement_tasks (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  source_subject_record_id uuid not null references public.daily_subject_records (id) on delete restrict,
  block_id uuid not null references public.class_schedule_blocks (id) on delete restrict,
  class_id uuid not null references public.classes (id) on delete restrict,
  subject_id uuid not null references public.subjects (id) on delete restrict,
  teacher_id uuid not null references public.profiles (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  record_date date not null,
  class_name_snapshot text not null,
  subject_name_snapshot text not null,
  classroom_name_snapshot text,
  is_active boolean not null default true,
  legacy_supplementary boolean not null default false,
  is_test_supplementary boolean not null default false,
  test_items jsonb not null default '[]'::jsonb,
  test_completed boolean not null default false,
  test_completed_by_profile_id uuid references public.profiles (id) on delete restrict,
  test_completed_at timestamptz,
  is_homework_supplementary boolean not null default false,
  homework_content text,
  homework_completed boolean not null default false,
  homework_completed_by_profile_id uuid references public.profiles (id) on delete restrict,
  homework_completed_at timestamptz,
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (academy_id, source_subject_record_id),
  check (not is_active or legacy_supplementary or is_test_supplementary or is_homework_supplementary)
);

create index if not exists student_supplement_tasks_teacher_date_idx
  on public.student_supplement_tasks (academy_id, teacher_id, record_date);

create index if not exists student_supplement_tasks_class_subject_date_idx
  on public.student_supplement_tasks (academy_id, class_id, subject_id, record_date);

create index if not exists student_supplement_tasks_student_date_idx
  on public.student_supplement_tasks (academy_id, student_id, record_date);

create or replace function private.teacher_can_access_supplement_task(
  p_academy_id uuid,
  p_task_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.student_supplement_tasks t
    where t.id = p_task_id
      and t.academy_id = p_academy_id
      and t.teacher_id = private.current_profile_id()
      and private.has_academy_role(p_academy_id, array['teacher']::text[])
  );
$$;

grant execute on function private.teacher_can_access_supplement_task(uuid, uuid) to authenticated;

alter table public.student_supplement_tasks enable row level security;
revoke all on table public.student_supplement_tasks from anon, authenticated;
grant select, insert, update on table public.student_supplement_tasks to authenticated;

drop policy if exists supplement_tasks_select on public.student_supplement_tasks;
create policy supplement_tasks_select on public.student_supplement_tasks
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_access_supplement_task(academy_id, id)
);

drop policy if exists supplement_tasks_insert on public.student_supplement_tasks;
create policy supplement_tasks_insert on public.student_supplement_tasks
for insert to authenticated
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    teacher_id = private.current_profile_id()
    and created_by_profile_id = private.current_profile_id()
    and private.has_academy_role(academy_id, array['teacher']::text[])
  )
);

drop policy if exists supplement_tasks_update on public.student_supplement_tasks;
create policy supplement_tasks_update on public.student_supplement_tasks
for update to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_access_supplement_task(academy_id, id)
)
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_access_supplement_task(academy_id, id)
);

create or replace function private.student_supplement_tasks_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  new.version = old.version + 1;
  return new;
end;
$$;

drop trigger if exists student_supplement_tasks_set_updated_at on public.student_supplement_tasks;
create trigger student_supplement_tasks_set_updated_at
before update on public.student_supplement_tasks
for each row execute function private.student_supplement_tasks_set_updated_at();

-- Preserve existing generic supplementary flags as legacy tasks. New records use
-- the separate test/homework flags and are synchronized by the teacher API.
insert into public.student_supplement_tasks (
  academy_id,
  source_subject_record_id,
  block_id,
  class_id,
  subject_id,
  teacher_id,
  student_id,
  record_date,
  class_name_snapshot,
  subject_name_snapshot,
  classroom_name_snapshot,
  is_active,
  legacy_supplementary,
  test_items,
  created_by_profile_id
)
select
  dsr.academy_id,
  dsr.id,
  dsr.block_id,
  b.class_id,
  dsr.subject_id,
  dsr.teacher_id,
  dsr.student_id,
  dsr.record_date,
  b.class_name_snapshot,
  dsr.subject_name_snapshot,
  b.classroom_name_snapshot,
  true,
  true,
  jsonb_build_object(
    'testDefinitions', coalesce(dsr.test_definitions, '[]'::jsonb),
    'testResults', coalesce(dsr.test_results, '[]'::jsonb)
  ),
  dsr.teacher_id
from public.daily_subject_records dsr
join public.class_schedule_blocks b on b.id = dsr.block_id
where dsr.is_supplementary = true
on conflict (academy_id, source_subject_record_id) do nothing;
