begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

select ok(
  to_regprocedure('public.transition_student_status_transaction(uuid,uuid,text,text,date,text,text,date,jsonb,uuid)') is not null,
  'student status transaction function exists'
);
select ok(
  has_function_privilege('service_role', 'public.transition_student_status_transaction(uuid,uuid,text,text,date,text,text,date,jsonb,uuid)', 'EXECUTE'),
  'service role can execute student status transaction'
);
select ok(
  not has_function_privilege('authenticated', 'public.transition_student_status_transaction(uuid,uuid,text,text,date,text,text,date,jsonb,uuid)', 'EXECUTE'),
  'authenticated cannot execute student status transaction directly'
);

select ok(
  to_regprocedure('public.save_daily_records_transaction(uuid,uuid,uuid,date,text,jsonb,jsonb,jsonb,uuid[],uuid[],uuid[],uuid)') is not null,
  'daily record transaction function exists'
);
select ok(
  has_function_privilege('service_role', 'public.save_daily_records_transaction(uuid,uuid,uuid,date,text,jsonb,jsonb,jsonb,uuid[],uuid[],uuid[],uuid)', 'EXECUTE'),
  'service role can execute daily record transaction'
);
select ok(
  not has_function_privilege('authenticated', 'public.save_daily_records_transaction(uuid,uuid,uuid,date,text,jsonb,jsonb,jsonb,uuid[],uuid[],uuid[],uuid)', 'EXECUTE'),
  'authenticated cannot execute daily record transaction directly'
);

select ok(
  to_regprocedure('public.revoke_guardian_invite_transaction(uuid,uuid,uuid,uuid)') is not null
  and to_regprocedure('public.reissue_guardian_invite_transaction(uuid,uuid,uuid,text,text,timestamptz,uuid)') is not null,
  'guardian invite transaction functions exist'
);
select ok(
  has_function_privilege('service_role', 'public.revoke_guardian_invite_transaction(uuid,uuid,uuid,uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.reissue_guardian_invite_transaction(uuid,uuid,uuid,text,text,timestamptz,uuid)', 'EXECUTE'),
  'service role can execute guardian invite transactions'
);
select ok(
  not has_function_privilege('authenticated', 'public.revoke_guardian_invite_transaction(uuid,uuid,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.reissue_guardian_invite_transaction(uuid,uuid,uuid,text,text,timestamptz,uuid)', 'EXECUTE'),
  'authenticated cannot execute guardian invite transactions directly'
);

select ok(
  to_regprocedure('public.create_teacher_account_records_transaction(uuid,uuid,text,text,text,timestamptz,uuid)') is not null
  and to_regprocedure('public.activate_teacher_account_transaction(uuid,timestamptz)') is not null
  and to_regprocedure('public.deactivate_teacher_account_transaction(uuid,uuid,uuid,timestamptz)') is not null,
  'teacher account transaction functions exist'
);
select ok(
  has_function_privilege('service_role', 'public.create_teacher_account_records_transaction(uuid,uuid,text,text,text,timestamptz,uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.activate_teacher_account_transaction(uuid,timestamptz)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.deactivate_teacher_account_transaction(uuid,uuid,uuid,timestamptz)', 'EXECUTE'),
  'service role can execute teacher account transactions'
);
select ok(
  not has_function_privilege('authenticated', 'public.create_teacher_account_records_transaction(uuid,uuid,text,text,text,timestamptz,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.activate_teacher_account_transaction(uuid,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.deactivate_teacher_account_transaction(uuid,uuid,uuid,timestamptz)', 'EXECUTE'),
  'authenticated cannot execute teacher account transactions directly'
);

select throws_ok(
  $$select public.save_daily_records_transaction(
    '20000000-0000-0000-0000-000000000001'::uuid,
    '30000000-0000-0000-0000-000000000001'::uuid,
    '40000000-0000-0000-0000-000000000001'::uuid,
    '2026-10-12'::date,
    'invalid',
    '[]'::jsonb,
    '[]'::jsonb,
    null,
    '{}'::uuid[],
    '{}'::uuid[],
    '{}'::uuid[],
    '10000000-0000-0000-0000-000000000001'::uuid
  )$$,
  '22023',
  'invalid save mode',
  'invalid daily save mode is rejected before any write'
);

insert into public.class_schedule_blocks (
  id,
  academy_id,
  class_id,
  subject_id,
  teacher_id,
  class_name_snapshot,
  subject_name_snapshot,
  teacher_name_snapshot,
  weekday,
  start_time,
  end_time,
  effective_start,
  effective_end
)
values (
  '35000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '44000000-0000-4000-8000-000000000001',
  '45000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000002',
  'transaction test class',
  'transaction test subject',
  'transaction test teacher',
  'mon',
  '18:00',
  '19:00',
  '2026-01-01',
  '2027-12-31'
);

insert into public.class_schedule_block_students (academy_id, block_id, student_id, start_date)
values (
  '21000000-0000-4000-8000-000000000001',
  '35000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  '2026-01-01'
);

select lives_ok(
  $$select public.save_daily_records_transaction(
    '21000000-0000-4000-8000-000000000001'::uuid,
    '35000000-0000-4000-8000-000000000001'::uuid,
    '44000000-0000-4000-8000-000000000001'::uuid,
    '2026-10-12'::date,
    'draft',
    '[{"student_id":"51000000-0000-4000-8000-000000000001","attendance_status":"present","absence_note":null,"version":1,"expected_version":0}]'::jsonb,
    '[{"student_id":"51000000-0000-4000-8000-000000000001","subject_id":"45000000-0000-4000-8000-000000000001","teacher_id":"31000000-0000-4000-8000-000000000002","subject_name_snapshot":"transaction test subject","teacher_name_snapshot":"transaction test teacher","homework_score":5,"understanding_score":5,"participation_score":5,"is_supplementary":false,"is_test_supplementary":false,"is_homework_supplementary":false,"public_note":"retry baseline","test_definitions":[],"test_results":[],"version":1,"expected_version":0}]'::jsonb,
    null,
    '{}'::uuid[],
    '{"51000000-0000-4000-8000-000000000001"}'::uuid[],
    '{}'::uuid[],
    '31000000-0000-4000-8000-000000000002'::uuid
  )$$,
  'initial daily transaction fixture saves atomically'
);

select throws_ok(
  $$select public.save_daily_records_transaction(
    '21000000-0000-4000-8000-000000000001'::uuid,
    '35000000-0000-4000-8000-000000000001'::uuid,
    '44000000-0000-4000-8000-000000000001'::uuid,
    '2026-10-12'::date,
    'draft',
    '[{"student_id":"51000000-0000-4000-8000-000000000001","attendance_status":"present","absence_note":null,"version":1,"expected_version":0}]'::jsonb,
    '[{"student_id":"51000000-0000-4000-8000-000000000001","subject_id":"45000000-0000-4000-8000-000000000001","teacher_id":"31000000-0000-4000-8000-000000000002","subject_name_snapshot":"transaction test subject","teacher_name_snapshot":"transaction test teacher","homework_score":1,"understanding_score":1,"participation_score":1,"is_supplementary":false,"is_test_supplementary":false,"is_homework_supplementary":false,"public_note":"must not overwrite","test_definitions":[],"test_results":[],"version":1,"expected_version":0}]'::jsonb,
    null,
    '{}'::uuid[],
    '{"51000000-0000-4000-8000-000000000001"}'::uuid[],
    '{}'::uuid[],
    '31000000-0000-4000-8000-000000000002'::uuid
  )$$,
  '40001',
  'daily attendance record version conflict',
  'stale daily record retries are rejected'
);

select is(
  (select version from public.daily_attendance_records where academy_id = '21000000-0000-4000-8000-000000000001'::uuid and block_id = '35000000-0000-4000-8000-000000000001'::uuid and student_id = '51000000-0000-4000-8000-000000000001'::uuid and record_date = '2026-10-12'::date),
  1,
  'version conflict leaves the original attendance row unchanged'
);

select is(
  (select public_note from public.daily_subject_records where academy_id = '21000000-0000-4000-8000-000000000001'::uuid and block_id = '35000000-0000-4000-8000-000000000001'::uuid and student_id = '51000000-0000-4000-8000-000000000001'::uuid and record_date = '2026-10-12'::date),
  'retry baseline',
  'version conflict does not partially update the subject row'
);

select throws_ok(
  $$select public.save_daily_records_transaction(
    '21000000-0000-4000-8000-000000000001'::uuid,
    '35000000-0000-4000-8000-000000000001'::uuid,
    '44000000-0000-4000-8000-000000000001'::uuid,
    '2099-01-01'::date,
    'draft',
    '[{"student_id":"not-a-uuid","attendance_status":"present","version":1,"expected_version":0}]'::jsonb,
    '[]'::jsonb,
    '{"content":"rollback probe","no_homework":false}'::jsonb,
    '{}'::uuid[],
    '{}'::uuid[],
    '{}'::uuid[],
    '31000000-0000-4000-8000-000000000002'::uuid
  )$$,
  '22P02',
  null,
  'an invalid record row raises an error after homework preparation'
);

select is(
  (select count(*)::int from public.daily_common_homework where academy_id = '21000000-0000-4000-8000-000000000001'::uuid and class_id = '44000000-0000-4000-8000-000000000001'::uuid and record_date = '2099-01-01'::date),
  0,
  'a failed daily transaction rolls back homework written earlier in the function'
);

select * from finish();
rollback;
