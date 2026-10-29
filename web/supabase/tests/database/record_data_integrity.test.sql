begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

select ok(
  to_regprocedure('public.save_academy_lesson_record_settings_transaction(uuid,integer,boolean,boolean,boolean,jsonb,jsonb,uuid,jsonb,jsonb,text)') is not null,
  'lesson record settings transaction function exists'
);

select ok(
  has_function_privilege('service_role', 'public.save_academy_lesson_record_settings_transaction(uuid,integer,boolean,boolean,boolean,jsonb,jsonb,uuid,jsonb,jsonb,text)', 'EXECUTE'),
  'service role can execute the settings transaction'
);

select ok(
  not has_function_privilege('authenticated', 'public.save_academy_lesson_record_settings_transaction(uuid,integer,boolean,boolean,boolean,jsonb,jsonb,uuid,jsonb,jsonb,text)', 'EXECUTE'),
  'authenticated cannot execute the settings transaction directly'
);

create temporary table settings_before on commit drop as
select *
from public.academy_lesson_record_settings
where academy_id = '21000000-0000-4000-8000-000000000001'::uuid;

create temporary table settings_counts on commit drop as
select
  (select count(*)::int from public.academy_setting_history where academy_id = '21000000-0000-4000-8000-000000000001'::uuid and setting_key = 'lesson_record.form') as history_count,
  (select count(*)::int from public.audit_logs where academy_id = '21000000-0000-4000-8000-000000000001'::uuid and target_table = 'academy_lesson_record_settings' and target_id = '21000000-0000-4000-8000-000000000001'::uuid) as audit_count;

select throws_ok(
  $$select public.save_academy_lesson_record_settings_transaction(
    '21000000-0000-4000-8000-000000000001'::uuid,
    (select version from settings_before),
    (select tests_enabled from settings_before),
    (select student_memo_enabled from settings_before),
    (select common_record_enabled from settings_before),
    (select metrics from settings_before),
    (select supplement_types from settings_before),
    '31000000-0000-4000-8000-000000000001'::uuid,
    '{}'::jsonb,
    jsonb_build_object('version', (select version from settings_before) + 1),
    null
  )$$,
  '23502',
  null,
  'an audit failure aborts the settings transaction'
);

select is(
  (select version from public.academy_lesson_record_settings where academy_id = '21000000-0000-4000-8000-000000000001'::uuid),
  (select version from settings_before),
  'settings update is rolled back when audit insert fails'
);

select is(
  (select count(*)::int from public.academy_setting_history where academy_id = '21000000-0000-4000-8000-000000000001'::uuid and setting_key = 'lesson_record.form'),
  (select history_count from settings_counts),
  'settings history is rolled back with the setting update'
);

select is(
  (select count(*)::int from public.audit_logs where academy_id = '21000000-0000-4000-8000-000000000001'::uuid and target_table = 'academy_lesson_record_settings' and target_id = '21000000-0000-4000-8000-000000000001'::uuid),
  (select audit_count from settings_counts),
  'audit rows are unchanged after a failed settings transaction'
);

select lives_ok(
  $$select public.save_academy_lesson_record_settings_transaction(
    '21000000-0000-4000-8000-000000000001'::uuid,
    (select version from settings_before),
    (select tests_enabled from settings_before),
    (select student_memo_enabled from settings_before),
    (select common_record_enabled from settings_before),
    (select metrics from settings_before),
    (select supplement_types from settings_before),
    '31000000-0000-4000-8000-000000000001'::uuid,
    '{}'::jsonb,
    jsonb_build_object('version', (select version from settings_before) + 1),
    'integrity test'
  )$$,
  'a valid settings transaction succeeds'
);

select is(
  (select version from public.academy_lesson_record_settings where academy_id = '21000000-0000-4000-8000-000000000001'::uuid),
  (select version from settings_before) + 1,
  'successful settings transaction increments the version'
);

select is(
  (select count(*)::int from public.academy_setting_history where academy_id = '21000000-0000-4000-8000-000000000001'::uuid and setting_key = 'lesson_record.form'),
  (select history_count from settings_counts) + 1,
  'successful settings transaction writes one history row'
);

select is(
  (select count(*)::int from public.audit_logs where academy_id = '21000000-0000-4000-8000-000000000001'::uuid and target_table = 'academy_lesson_record_settings' and target_id = '21000000-0000-4000-8000-000000000001'::uuid),
  (select audit_count from settings_counts) + 1,
  'successful settings transaction writes one audit row'
);

select throws_ok(
  $$select public.save_academy_lesson_record_settings_transaction(
    '21000000-0000-4000-8000-000000000001'::uuid,
    (select version from public.academy_lesson_record_settings where academy_id = '21000000-0000-4000-8000-000000000001'::uuid),
    true,
    true,
    true,
    '[{"id":"00000000-0000-4000-8000-000000000101","isActive":true},{"id":"00000000-0000-4000-8000-000000000102","isActive":true},{"id":"00000000-0000-4000-8000-000000000103","isActive":true},{"id":"00000000-0000-4000-8000-000000000104","isActive":true},{"id":"00000000-0000-4000-8000-000000000105","isActive":true}]'::jsonb,
    (select supplement_types from public.academy_lesson_record_settings where academy_id = '21000000-0000-4000-8000-000000000001'::uuid),
    '31000000-0000-4000-8000-000000000001'::uuid,
    '{}'::jsonb,
    '{}'::jsonb,
    'limit test'
  )$$,
  '22023',
  null,
  'settings transaction rejects more than four active metrics'
);

select throws_ok(
  $$select public.save_academy_lesson_record_settings_transaction(
    '21000000-0000-4000-8000-000000000001'::uuid,
    (select version from public.academy_lesson_record_settings where academy_id = '21000000-0000-4000-8000-000000000001'::uuid),
    true,
    true,
    true,
    (select metrics from public.academy_lesson_record_settings where academy_id = '21000000-0000-4000-8000-000000000001'::uuid),
    '[{"id":"00000000-0000-4000-8000-000000000111","isActive":true},{"id":"00000000-0000-4000-8000-000000000112","isActive":true},{"id":"00000000-0000-4000-8000-000000000113","isActive":true},{"id":"00000000-0000-4000-8000-000000000114","isActive":true}]'::jsonb,
    '31000000-0000-4000-8000-000000000001'::uuid,
    '{}'::jsonb,
    '{}'::jsonb,
    'limit test'
  )$$,
  '22023',
  null,
  'settings transaction rejects more than three active supplement types'
);

insert into public.academies (id, name, status)
values ('22000000-0000-4000-8000-000000000001', 'RLS integrity academy', 'active');

insert into public.academy_memberships (academy_id, profile_id, role, is_active, activated_at)
values
  ('22000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000002', 'teacher', true, now());

insert into public.daily_teacher_record_admin_reviews (
  academy_id, teacher_id, record_date, updated_by_profile_id
) values (
  '22000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000002',
  '2099-01-03',
  '31000000-0000-4000-8000-000000000001'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11000000-0000-4000-8000-000000000001')::text, true);

select lives_ok(
  $$insert into public.daily_teacher_record_admin_reviews (
    academy_id, teacher_id, record_date, updated_by_profile_id
  ) values (
    '21000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000002',
    '2099-01-01',
    '31000000-0000-4000-8000-000000000001'
  )$$,
  'same-academy teacher review insert is allowed for an academy admin'
);

select throws_ok(
  $$insert into public.daily_teacher_record_admin_reviews (
    academy_id, teacher_id, record_date, updated_by_profile_id
  ) values (
    '21000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001',
    '2099-01-02',
    '31000000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  null,
  'review insert rejects a non-teacher teacher_id'
);

select is(
  (select count(*)::int from public.daily_teacher_record_admin_reviews where academy_id = '22000000-0000-4000-8000-000000000001'::uuid),
  0,
  'an academy admin cannot read another academy review'
);

select throws_ok(
  $$update public.daily_teacher_record_admin_reviews
    set teacher_id = '31000000-0000-4000-8000-000000000001'::uuid
    where academy_id = '21000000-0000-4000-8000-000000000001'::uuid
      and teacher_id = '31000000-0000-4000-8000-000000000002'::uuid
      and record_date = '2099-01-01'::date$$,
  '42501',
  null,
  'review update cannot move a row to a different teacher scope'
);

select * from finish();
rollback;
