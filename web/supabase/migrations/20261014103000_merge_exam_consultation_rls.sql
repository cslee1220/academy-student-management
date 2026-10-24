-- 내신 상담 권한은 별도 permissive policy를 늘리지 않고 기존 상담 정책에 합친다.
-- 기존 교사 이력 조회 정책은 과거 기록 조회 범위를 위해 그대로 유지한다.

drop policy if exists consultations_exam_teacher_select on public.parent_consultations;
drop policy if exists consultations_exam_teacher_insert on public.parent_consultations;
drop policy if exists consultations_exam_teacher_update on public.parent_consultations;

drop policy if exists consultations_select on public.parent_consultations;
create policy consultations_select on public.parent_consultations
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    teacher_id = private.current_profile_id()
    and (
      private.teacher_can_access_student(academy_id, student_id)
      or (
        consultation_type = 'exam'
        and exam_operation_id is not null
        and private.teacher_can_access_exam_consultation(academy_id, student_id, exam_operation_id)
      )
    )
  )
);

drop policy if exists consultations_insert on public.parent_consultations;
create policy consultations_insert on public.parent_consultations
for insert to authenticated
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    teacher_id = private.current_profile_id()
    and (
      private.teacher_can_access_student(academy_id, student_id)
      or (
        consultation_type = 'exam'
        and exam_operation_id is not null
        and private.teacher_can_access_exam_consultation(academy_id, student_id, exam_operation_id)
      )
    )
  )
);

drop policy if exists consultations_update on public.parent_consultations;
create policy consultations_update on public.parent_consultations
for update to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    teacher_id = private.current_profile_id()
    and (
      private.teacher_can_access_student(academy_id, student_id)
      or (
        consultation_type = 'exam'
        and exam_operation_id is not null
        and private.teacher_can_access_exam_consultation(academy_id, student_id, exam_operation_id)
      )
    )
  )
)
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    teacher_id = private.current_profile_id()
    and (
      private.teacher_can_access_student(academy_id, student_id)
      or (
        consultation_type = 'exam'
        and exam_operation_id is not null
        and private.teacher_can_access_exam_consultation(academy_id, student_id, exam_operation_id)
      )
    )
  )
);
