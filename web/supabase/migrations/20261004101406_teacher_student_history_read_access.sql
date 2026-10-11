-- Allow a teacher to read finalized historical records for students currently
-- assigned to that teacher. This is read-only and does not expand write access.

create or replace function private.teacher_can_view_current_student_history(
  p_academy_id uuid,
  p_student_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select exists (
    select 1
    from public.class_schedule_blocks b
    join public.class_schedule_block_students bs
      on bs.academy_id = b.academy_id
     and bs.block_id = b.id
     and bs.student_id = p_student_id
    where b.academy_id = p_academy_id
      and b.teacher_id = private.current_profile_id()
      and b.is_active
      and (timezone('Asia/Seoul', now()))::date between b.effective_start and b.effective_end
      and bs.is_active
      and (timezone('Asia/Seoul', now()))::date between bs.start_date and coalesce(bs.end_date, (timezone('Asia/Seoul', now()))::date)
      and private.has_academy_role(p_academy_id, array['teacher']::text[])
  )
$$;

create or replace function private.teacher_can_view_history_class(
  p_academy_id uuid,
  p_class_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select exists (
    select 1
    from public.class_schedule_blocks b
    join public.class_schedule_block_students bs
      on bs.academy_id = b.academy_id
     and bs.block_id = b.id
    where b.academy_id = p_academy_id
      and b.class_id = p_class_id
      and b.teacher_id = private.current_profile_id()
      and b.is_active
      and (timezone('Asia/Seoul', now()))::date between b.effective_start and b.effective_end
      and bs.is_active
      and (timezone('Asia/Seoul', now()))::date between bs.start_date and coalesce(bs.end_date, (timezone('Asia/Seoul', now()))::date)
      and private.has_academy_role(p_academy_id, array['teacher']::text[])
  )
$$;

create or replace function private.teacher_can_view_history_session(
  p_academy_id uuid,
  p_session_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select exists (
    select 1
    from public.class_sessions cs
    where cs.academy_id = p_academy_id
      and cs.id = p_session_id
      and private.teacher_can_view_history_class(cs.academy_id, cs.class_id)
  )
$$;

create or replace function private.teacher_can_view_history_session_student(
  p_academy_id uuid,
  p_session_id uuid,
  p_student_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select private.teacher_can_view_current_student_history(p_academy_id, p_student_id)
    and exists (
      select 1
      from public.session_student_rosters ssr
      where ssr.academy_id = p_academy_id
        and ssr.session_id = p_session_id
        and ssr.student_id = p_student_id
        and ssr.is_expected
    )
$$;

grant execute on function private.teacher_can_view_current_student_history(uuid, uuid) to authenticated;
grant execute on function private.teacher_can_view_history_class(uuid, uuid) to authenticated;
grant execute on function private.teacher_can_view_history_session(uuid, uuid) to authenticated;
grant execute on function private.teacher_can_view_history_session_student(uuid, uuid, uuid) to authenticated;

drop policy if exists teacher_history_students_select on public.students;
create policy teacher_history_students_select
on public.students
for select to authenticated
using (private.teacher_can_view_current_student_history(academy_id, id));

drop policy if exists teacher_history_terms_select on public.terms;
create policy teacher_history_terms_select
on public.terms
for select to authenticated
using (private.has_academy_role(academy_id, array['teacher']::text[]));

drop policy if exists teacher_history_classes_select on public.classes;
create policy teacher_history_classes_select
on public.classes
for select to authenticated
using (private.teacher_can_view_history_class(academy_id, id));

drop policy if exists teacher_history_assignments_select on public.student_class_assignments;
create policy teacher_history_assignments_select
on public.student_class_assignments
for select to authenticated
using (private.teacher_can_view_current_student_history(academy_id, student_id));

drop policy if exists teacher_history_sessions_select on public.class_sessions;
create policy teacher_history_sessions_select
on public.class_sessions
for select to authenticated
using (private.teacher_can_view_history_session(academy_id, id));

drop policy if exists teacher_history_session_subjects_select on public.session_subject_assignments;
create policy teacher_history_session_subjects_select
on public.session_subject_assignments
for select to authenticated
using (private.teacher_can_view_history_session(academy_id, session_id));

drop policy if exists teacher_history_rosters_select on public.session_student_rosters;
create policy teacher_history_rosters_select
on public.session_student_rosters
for select to authenticated
using (private.teacher_can_view_history_session_student(academy_id, session_id, student_id));

drop policy if exists teacher_history_attendance_select on public.attendance_records;
create policy teacher_history_attendance_select
on public.attendance_records
for select to authenticated
using (private.teacher_can_view_history_session_student(academy_id, session_id, student_id));

drop policy if exists teacher_history_homework_select on public.common_homework;
create policy teacher_history_homework_select
on public.common_homework
for select to authenticated
using (final_saved_at is not null and private.teacher_can_view_history_class(academy_id, class_id));

drop policy if exists teacher_history_subject_records_select on public.teacher_subject_records;
create policy teacher_history_subject_records_select
on public.teacher_subject_records
for select to authenticated
using (
  status = 'final'
  and private.teacher_can_view_history_session_student(academy_id, session_id, student_id)
);

drop policy if exists teacher_history_test_definitions_select on public.test_definitions;
create policy teacher_history_test_definitions_select
on public.test_definitions
for select to authenticated
using (private.teacher_can_view_history_session(academy_id, session_id));

drop policy if exists teacher_history_test_results_select on public.student_test_results;
create policy teacher_history_test_results_select
on public.student_test_results
for select to authenticated
using (
  exists (
    select 1
    from public.test_definitions td
    where td.academy_id = student_test_results.academy_id
      and td.id = student_test_results.test_definition_id
      and private.teacher_can_view_history_session_student(td.academy_id, td.session_id, student_test_results.student_id)
  )
);

drop policy if exists teacher_history_daily_attendance_select on public.daily_attendance_records;
create policy teacher_history_daily_attendance_select
on public.daily_attendance_records
for select to authenticated
using (
  save_state = 'final'
  and private.teacher_can_view_current_student_history(academy_id, student_id)
);

drop policy if exists teacher_history_daily_subject_select on public.daily_subject_records;
create policy teacher_history_daily_subject_select
on public.daily_subject_records
for select to authenticated
using (
  save_state = 'final'
  and private.teacher_can_view_current_student_history(academy_id, student_id)
);

drop policy if exists teacher_history_daily_homework_select on public.daily_common_homework;
create policy teacher_history_daily_homework_select
on public.daily_common_homework
for select to authenticated
using (
  save_state = 'final'
  and private.teacher_can_view_history_class(academy_id, class_id)
);

drop policy if exists teacher_history_supplement_tasks_select on public.student_supplement_tasks;
create policy teacher_history_supplement_tasks_select
on public.student_supplement_tasks
for select to authenticated
using (private.teacher_can_view_current_student_history(academy_id, student_id));

drop policy if exists teacher_history_consultations_select on public.parent_consultations;
create policy teacher_history_consultations_select
on public.parent_consultations
for select to authenticated
using (private.teacher_can_view_current_student_history(academy_id, student_id));
