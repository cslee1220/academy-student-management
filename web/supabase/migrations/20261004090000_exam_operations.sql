-- 내신 운영은 학생별 원래 반을 보존한 상태에서 한시적으로 내신 반을 사용하고,
-- 종료일 다음 날 원래 반으로 돌아가는 예약 배정으로 관리한다.

update public.academy_operation_types
set name = '내신', updated_at = now()
where code = 'exam_prep';

create table if not exists public.exam_operations (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  term_id uuid not null references public.terms (id) on delete restrict,
  subject_id uuid not null references public.subjects (id) on delete restrict,
  name text not null default '내신',
  start_date date not null,
  end_date date not null,
  return_date date not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'active', 'completed', 'cancelled')),
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_date <= end_date),
  check (return_date = end_date + 1),
  unique (academy_id, name, start_date)
);

create index if not exists exam_operations_period_idx
  on public.exam_operations (academy_id, start_date, end_date, status);

alter table public.student_class_assignments
  add column if not exists exam_operation_id uuid references public.exam_operations (id) on delete restrict,
  add column if not exists source_assignment_id uuid references public.student_class_assignments (id) on delete restrict,
  add column if not exists assignment_role text check (assignment_role in ('regular', 'exam', 'return'));

create index if not exists student_class_assignments_exam_operation_idx
  on public.student_class_assignments (academy_id, exam_operation_id, student_id, start_date);

create table if not exists public.exam_operation_students (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  exam_operation_id uuid not null references public.exam_operations (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete restrict,
  source_assignment_id uuid not null references public.student_class_assignments (id) on delete restrict,
  exam_assignment_id uuid not null references public.student_class_assignments (id) on delete restrict,
  return_assignment_id uuid not null references public.student_class_assignments (id) on delete restrict,
  exam_class_id uuid not null references public.classes (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exam_operation_id, student_id)
);

create index if not exists exam_operation_students_student_idx
  on public.exam_operation_students (academy_id, student_id, exam_operation_id);

create or replace function private.exam_operations_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists exam_operations_set_updated_at on public.exam_operations;
create trigger exam_operations_set_updated_at
before update on public.exam_operations
for each row execute function private.exam_operations_set_updated_at();

drop trigger if exists exam_operation_students_set_updated_at on public.exam_operation_students;
create trigger exam_operation_students_set_updated_at
before update on public.exam_operation_students
for each row execute function private.exam_operations_set_updated_at();

alter table public.exam_operations enable row level security;
alter table public.exam_operation_students enable row level security;

revoke all on table public.exam_operations, public.exam_operation_students from anon, authenticated;
grant select, insert, update on table public.exam_operations, public.exam_operation_students to authenticated;

drop policy if exists exam_operations_admin on public.exam_operations;
create policy exam_operations_admin on public.exam_operations
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));

drop policy if exists exam_operation_students_admin on public.exam_operation_students;
create policy exam_operation_students_admin on public.exam_operation_students
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));
