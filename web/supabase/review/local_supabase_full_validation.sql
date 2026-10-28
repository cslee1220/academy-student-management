-- REVIEW-ONLY: local Supabase full-stack validation.
-- Uses seeded synthetic fixtures and rolls back all temporary rows.
-- Never run this file against a hosted or production database.

\set ON_ERROR_STOP on

begin;

do $$
declare
  v_academy_id uuid;
  v_class_id uuid;
  v_subject_id uuid;
  v_subject_id_2 uuid;
  v_teacher_id uuid;
  v_student_id uuid;
  v_actor_profile_id uuid;
  v_block_id uuid;
  v_block_id_2 uuid;
  v_record_date date := date '2026-10-26';
  v_result jsonb;
  v_count integer;
  v_before integer;
begin
  select a.id, c.id
    into v_academy_id, v_class_id
  from public.academies a
  join public.classes c on c.academy_id = a.id
  order by c.id
  limit 1;

  select s.id
    into v_subject_id
  from public.subjects s
  where s.academy_id = v_academy_id
  order by s.id
  limit 1;

  select s.id
    into v_subject_id_2
  from public.subjects s
  where s.academy_id = v_academy_id
    and s.id <> v_subject_id
  order by s.id
  limit 1;

  select p.id
    into v_teacher_id
  from public.profiles p
  join public.academy_memberships am on am.profile_id = p.id
  where am.academy_id = v_academy_id
    and am.role = 'teacher'
    and am.is_active
  order by p.id
  limit 1;

  select s.id
    into v_student_id
  from public.students s
  where s.academy_id = v_academy_id
  order by s.id
  limit 1;

  select p.id
    into v_actor_profile_id
  from public.profiles p
  join public.academy_memberships am on am.profile_id = p.id
  where am.academy_id = v_academy_id
    and am.role = 'academy_admin'
    and am.is_active
  order by p.id
  limit 1;

  if v_academy_id is null or v_class_id is null or v_subject_id is null
     or v_subject_id_2 is null or v_teacher_id is null or v_student_id is null
     or v_actor_profile_id is null then
    raise exception 'synthetic seed prerequisites are missing';
  end if;

  insert into public.class_schedule_blocks (
    academy_id, class_id, subject_id, teacher_id,
    class_name_snapshot, subject_name_snapshot, teacher_name_snapshot,
    weekday, start_time, end_time, effective_start, effective_end
  ) values (
    v_academy_id, v_class_id, v_subject_id, v_teacher_id,
    'Synthetic Class', 'Synthetic Subject One', 'Synthetic Teacher',
    'mon', time '09:00', time '10:00', date '2026-01-01', date '2026-12-31'
  ) returning id into v_block_id;

  insert into public.class_schedule_block_students (
    academy_id, block_id, student_id, start_date, end_date, operation_group
  ) values (
    v_academy_id, v_block_id, v_student_id,
    date '2026-01-01', date '2026-12-31', 'A'
  );

  -- New grouped homework plus attendance and subject record.
  v_result := public.save_daily_records_with_grouped_homework_transaction(
    v_academy_id,
    v_block_id,
    v_class_id,
    v_record_date,
    'draft',
    jsonb_build_array(jsonb_build_object(
      'student_id', v_student_id,
      'attendance_status', 'present',
      'absence_note', null,
      'version', 1,
      'expected_version', null
    )),
    jsonb_build_array(jsonb_build_object(
      'student_id', v_student_id,
      'subject_id', v_subject_id,
      'teacher_id', v_teacher_id,
      'subject_name_snapshot', 'Synthetic Subject One',
      'teacher_name_snapshot', 'Synthetic Teacher',
      'homework_score', 4,
      'understanding_score', 4,
      'participation_score', 4,
      'is_supplementary', false,
      'is_test_supplementary', false,
      'is_homework_supplementary', false,
      'test_definitions', '[]'::jsonb,
      'test_results', '[]'::jsonb,
      'save_state', 'draft',
      'version', 1,
      'expected_version', null
    )),
    jsonb_build_object(
      'A', jsonb_build_object('content', 'synthetic group A', 'no_homework', false),
      'B', jsonb_build_object('content', 'synthetic group B', 'no_homework', false)
    ),
    array[v_block_id], array[v_student_id], array[]::uuid[],
    v_actor_profile_id, '[]'::jsonb
  );

  if (v_result->>'grouped_homework_saved_count')::integer <> 2 then
    raise exception 'grouped homework initial save count mismatch';
  end if;

  select count(*) into v_count
  from public.daily_common_homework
  where academy_id = v_academy_id
    and class_id = v_class_id
    and record_date = v_record_date
    and subject_id = v_subject_id;
  if v_count <> 2 then
    raise exception 'subject-scoped homework rows were not separated';
  end if;

  -- Repeat with matching versions: rows remain unique and are updated.
  v_result := public.save_daily_records_with_grouped_homework_transaction(
    v_academy_id, v_block_id, v_class_id, v_record_date, 'final',
    jsonb_build_array(jsonb_build_object(
      'student_id', v_student_id, 'attendance_status', 'present',
      'absence_note', null, 'version', 1, 'expected_version', 1
    )),
    jsonb_build_array(jsonb_build_object(
      'student_id', v_student_id, 'subject_id', v_subject_id,
      'teacher_id', v_teacher_id, 'subject_name_snapshot', 'Synthetic Subject One',
      'teacher_name_snapshot', 'Synthetic Teacher', 'homework_score', 5,
      'understanding_score', 5, 'participation_score', 5,
      'is_supplementary', false, 'is_test_supplementary', false,
      'is_homework_supplementary', false, 'test_definitions', '[]'::jsonb,
      'test_results', '[]'::jsonb, 'save_state', 'final', 'version', 1,
      'expected_version', 1
    )),
    jsonb_build_object(
      'A', jsonb_build_object('content', 'synthetic group A updated', 'no_homework', false, 'version', 1),
      'B', jsonb_build_object('content', 'synthetic group B updated', 'no_homework', false, 'version', 1)
    ),
    array[v_block_id], array[]::uuid[], array[v_student_id],
    v_actor_profile_id, '[]'::jsonb
  );

  select count(*) into v_count
  from public.daily_common_homework
  where academy_id = v_academy_id
    and class_id = v_class_id
    and record_date = v_record_date
    and subject_id = v_subject_id;
  if v_count <> 2 then
    raise exception 'repeated grouped save created duplicate rows';
  end if;

  if not exists (
    select 1 from public.daily_record_publications
    where academy_id = v_academy_id and student_id = v_student_id
      and record_date = v_record_date and status = 'published'
  ) then
    raise exception 'final save did not publish the synthetic student date';
  end if;

  -- A second subject gets an independent block and independent homework rows.
  insert into public.class_schedule_blocks (
    academy_id, class_id, subject_id, teacher_id,
    class_name_snapshot, subject_name_snapshot, teacher_name_snapshot,
    weekday, start_time, end_time, effective_start, effective_end
  ) values (
    v_academy_id, v_class_id, v_subject_id_2, v_teacher_id,
    'Synthetic Class', 'Synthetic Subject Two', 'Synthetic Teacher',
    'mon', time '10:00', time '11:00', date '2026-01-01', date '2026-12-31'
  ) returning id into v_block_id_2;

  insert into public.class_schedule_block_students (
    academy_id, block_id, student_id, start_date, end_date, operation_group
  ) values (
    v_academy_id, v_block_id_2, v_student_id,
    date '2026-01-01', date '2026-12-31', 'A'
  );

  perform public.save_daily_records_with_grouped_homework_transaction(
    v_academy_id, v_block_id_2, v_class_id, v_record_date, 'draft',
    '[]'::jsonb, '[]'::jsonb,
    jsonb_build_object('A', jsonb_build_object('content', 'synthetic subject two', 'no_homework', false)),
    array[]::uuid[], array[]::uuid[], array[]::uuid[], v_actor_profile_id, '[]'::jsonb
  );

  select count(*) into v_count
  from public.daily_common_homework
  where academy_id = v_academy_id and class_id = v_class_id
    and record_date = v_record_date and subject_id is not null;
  if v_count <> 3 then
    raise exception 'different subject homework was overwritten';
  end if;

  -- Legacy signature writes only the subjectless/common compatibility scope.
  perform public.save_daily_records_transaction(
    v_academy_id, v_block_id, v_class_id, v_record_date + 1, 'draft',
    '[]'::jsonb, '[]'::jsonb,
    jsonb_build_object('content', 'synthetic legacy common', 'no_homework', false),
    array[]::uuid[], array[]::uuid[], array[]::uuid[], v_actor_profile_id
  );
  if not exists (
    select 1 from public.daily_common_homework
    where academy_id = v_academy_id and class_id = v_class_id
      and record_date = v_record_date + 1
      and subject_id is null and operation_group = 'common'
  ) then
    raise exception 'legacy common row was not created in the compatibility scope';
  end if;

  -- A downstream constraint failure must roll back the homework written first.
  select count(*) into v_before
  from public.daily_common_homework
  where academy_id = v_academy_id and class_id = v_class_id
    and record_date = v_record_date + 2;
  begin
    perform public.save_daily_records_transaction(
      v_academy_id, v_block_id, v_class_id, v_record_date + 2, 'draft',
      jsonb_build_array(jsonb_build_object(
        'student_id', v_student_id, 'attendance_status', 'not-a-status',
        'absence_note', null, 'version', 1, 'expected_version', null
      )),
      '[]'::jsonb,
      jsonb_build_object('content', 'must rollback', 'no_homework', false),
      array[]::uuid[], array[]::uuid[], array[]::uuid[], v_actor_profile_id
    );
    raise exception 'invalid attendance unexpectedly succeeded';
  exception when others then
    null;
  end;
  select count(*) into v_count
  from public.daily_common_homework
  where academy_id = v_academy_id and class_id = v_class_id
    and record_date = v_record_date + 2;
  if v_count <> v_before then
    raise exception 'failed transaction left a partial homework row';
  end if;

  raise notice 'LOCAL_SUPABASE_FULL_VALIDATION_PASS';
end;
$$;

rollback;
