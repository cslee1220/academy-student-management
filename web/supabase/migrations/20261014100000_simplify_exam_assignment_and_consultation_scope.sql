-- Keep legacy return assignments readable, but make the new exam flow rely on
-- the original regular assignment for the post-exam fallback.
alter table public.exam_operation_students
  alter column return_assignment_id drop not null;

alter table public.parent_consultations
  add column if not exists consultation_type text not null default 'regular',
  add column if not exists exam_operation_id uuid references public.exam_operations (id) on delete set null;

alter table public.parent_consultations
  drop constraint if exists parent_consultations_consultation_type_check;

alter table public.parent_consultations
  add constraint parent_consultations_consultation_type_check
  check (consultation_type in ('regular', 'exam'));

create index if not exists exam_operation_students_exam_assignment_idx
  on public.exam_operation_students (academy_id, student_id, exam_assignment_id);

create index if not exists parent_consultations_exam_scope_idx
  on public.parent_consultations (academy_id, consultation_type, exam_operation_id, student_id, consultation_at desc);

create or replace function private.teacher_can_access_exam_consultation(
  p_academy_id uuid,
  p_student_id uuid,
  p_exam_operation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select exists (
    select 1
    from public.exam_operation_students eos
    join public.exam_operations eo
      on eo.id = eos.exam_operation_id
     and eo.academy_id = p_academy_id
    join public.class_subject_teacher_assignments csta
      on csta.class_id = eos.exam_class_id
     and csta.subject_id = eo.subject_id
     and csta.academy_id = p_academy_id
    where eos.academy_id = p_academy_id
      and eos.student_id = p_student_id
      and eos.exam_operation_id = p_exam_operation_id
      and eo.status <> 'cancelled'
      and csta.teacher_id = private.current_profile_id()
      and csta.is_active = true
      and csta.effective_start <= eo.end_date
      and (csta.effective_end is null or csta.effective_end >= eo.start_date)
  );
$$;

drop policy if exists consultations_exam_teacher_select on public.parent_consultations;
create policy consultations_exam_teacher_select on public.parent_consultations
for select to authenticated
using (
  consultation_type = 'exam'
  and exam_operation_id is not null
  and teacher_id = private.current_profile_id()
  and private.teacher_can_access_exam_consultation(academy_id, student_id, exam_operation_id)
);

drop policy if exists consultations_exam_teacher_insert on public.parent_consultations;
create policy consultations_exam_teacher_insert on public.parent_consultations
for insert to authenticated
with check (
  consultation_type = 'exam'
  and exam_operation_id is not null
  and teacher_id = private.current_profile_id()
  and private.teacher_can_access_exam_consultation(academy_id, student_id, exam_operation_id)
);

drop policy if exists consultations_exam_teacher_update on public.parent_consultations;
create policy consultations_exam_teacher_update on public.parent_consultations
for update to authenticated
using (
  consultation_type = 'exam'
  and exam_operation_id is not null
  and teacher_id = private.current_profile_id()
  and private.teacher_can_access_exam_consultation(academy_id, student_id, exam_operation_id)
)
with check (
  consultation_type = 'exam'
  and exam_operation_id is not null
  and teacher_id = private.current_profile_id()
  and private.teacher_can_access_exam_consultation(academy_id, student_id, exam_operation_id)
);

-- Existing consultation rows are regular-class consultations. New exam
-- consultations are still protected by the existing teacher/admin policies;
-- the route additionally validates participation in the selected operation.
