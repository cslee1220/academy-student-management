begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

select ok(
  to_regprocedure('public.save_daily_records_with_supplements_transaction(uuid,uuid,uuid,date,text,jsonb,jsonb,jsonb,uuid[],uuid[],uuid[],uuid,jsonb)') is not null,
  'daily record and supplement transaction function exists'
);

select ok(
  has_function_privilege('service_role', 'public.save_daily_records_with_supplements_transaction(uuid,uuid,uuid,date,text,jsonb,jsonb,jsonb,uuid[],uuid[],uuid[],uuid,jsonb)', 'EXECUTE'),
  'service role can execute the combined daily record transaction'
);

select ok(
  not has_function_privilege('authenticated', 'public.save_daily_records_with_supplements_transaction(uuid,uuid,uuid,date,text,jsonb,jsonb,jsonb,uuid[],uuid[],uuid[],uuid,jsonb)', 'EXECUTE'),
  'authenticated cannot execute the combined daily record transaction directly'
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
  '35000000-0000-4000-8000-000000000002',
  '21000000-0000-4000-8000-000000000001',
  '44000000-0000-4000-8000-000000000001',
  '45000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000002',
  'supplement transaction test class',
  'supplement transaction test subject',
  'supplement transaction test teacher',
  'tue',
  '18:00',
  '19:00',
  '2026-01-01',
  '2027-12-31'
);

insert into public.class_schedule_block_students (academy_id, block_id, student_id, start_date)
values (
  '21000000-0000-4000-8000-000000000001',
  '35000000-0000-4000-8000-000000000002',
  '51000000-0000-4000-8000-000000000001',
  '2026-01-01'
);

select throws_ok(
  $$select public.save_daily_records_with_supplements_transaction(
    '21000000-0000-4000-8000-000000000001'::uuid,
    '35000000-0000-4000-8000-000000000002'::uuid,
    '44000000-0000-4000-8000-000000000001'::uuid,
    '2026-10-13'::date,
    'draft',
    '[{"student_id":"51000000-0000-4000-8000-000000000001","attendance_status":"present","absence_note":null,"version":1,"expected_version":0}]'::jsonb,
    '[{"student_id":"51000000-0000-4000-8000-000000000001","subject_id":"45000000-0000-4000-8000-000000000001","teacher_id":"31000000-0000-4000-8000-000000000002","subject_name_snapshot":"supplement transaction test subject","teacher_name_snapshot":"supplement transaction test teacher","homework_score":5,"understanding_score":5,"participation_score":5,"is_supplementary":false,"is_test_supplementary":false,"is_homework_supplementary":false,"public_note":"atomicity probe","test_definitions":[],"test_results":[],"version":1,"expected_version":0}]'::jsonb,
    null,
    '{}'::uuid[],
    '{"51000000-0000-4000-8000-000000000001"}'::uuid[],
    '{}'::uuid[],
    '31000000-0000-4000-8000-000000000002'::uuid,
    '[{"student_id":"not-a-uuid"}]'::jsonb
  )$$,
  '22P02',
  null,
  'supplement task input failure raises after core record preparation'
);

select is(
  (
    select count(*)::int
    from public.daily_attendance_records
    where academy_id = '21000000-0000-4000-8000-000000000001'::uuid
      and block_id = '35000000-0000-4000-8000-000000000002'::uuid
      and record_date = '2026-10-13'::date
  )
  + (
    select count(*)::int
    from public.daily_subject_records
    where academy_id = '21000000-0000-4000-8000-000000000001'::uuid
      and block_id = '35000000-0000-4000-8000-000000000002'::uuid
      and record_date = '2026-10-13'::date
  )
  + (
    select count(*)::int
    from public.daily_record_publications
    where academy_id = '21000000-0000-4000-8000-000000000001'::uuid
      and record_date = '2026-10-13'::date
  ),
  0,
  'supplement task failure rolls back core attendance, subject, and publication rows'
);

select * from finish();
rollback;
