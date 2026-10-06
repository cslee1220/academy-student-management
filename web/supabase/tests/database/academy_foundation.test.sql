begin;

create extension if not exists pgtap with schema extensions;

select plan(100);

select ok(
  to_regprocedure('private.teacher_can_view_current_student_history(uuid,uuid)') is not null,
  'teacher historical access uses the current-student scope helper'
);

select has_table('public', 'class_schedule_blocks', '날짜 기반 수업 운영 블록 테이블이 존재한다');
select has_table('public', 'class_schedule_block_students', '날짜 기반 운영 학생 배정 테이블이 존재한다');
select has_table('public', 'daily_attendance_records', '날짜 기반 출결 테이블이 존재한다');
select has_table('public', 'daily_common_homework', '날짜 기반 공통 숙제 테이블이 존재한다');
select has_table('public', 'daily_subject_records', '날짜 기반 과목 기록 테이블이 존재한다');
select has_column('public', 'class_schedule_blocks', 'classroom_name_snapshot', '운영 블록에 강의실 스냅샷이 존재한다');
select has_column('public', 'academy_operation_schedules', 'effective_start', '운영 시간표 유효 시작일이 존재한다');
select has_column('public', 'academy_operation_schedules', 'effective_end', '운영 시간표 유효 종료일이 존재한다');
select policies_are(
  'public',
  'class_schedule_blocks',
  array['daily_blocks_admin', 'daily_blocks_guardian_select', 'daily_blocks_teacher_select'],
  '운영 블록 정책은 운영자·교사·보호자 범위로 구성된다'
);
select policies_are(
  'public',
  'class_schedule_block_students',
  array['daily_block_students_admin', 'daily_block_students_guardian_select', 'daily_block_students_teacher_select'],
  '운영 블록 학생 정책은 운영자·교사·보호자 범위로 구성된다'
);
select policies_are(
  'public',
  'daily_attendance_records',
  array['daily_attendance_access', 'daily_attendance_update', 'daily_attendance_write', 'teacher_history_daily_attendance_select'],
  '날짜 기반 출결 정책은 조회·입력·수정으로 구성된다'
);
select policies_are(
  'public',
  'daily_common_homework',
  array['daily_homework_access', 'daily_homework_write', 'teacher_history_daily_homework_select'],
  '날짜 기반 공통 숙제 정책은 조회·저장으로 구성된다'
);
select policies_are(
  'public',
  'daily_subject_records',
  array['daily_subject_access', 'daily_subject_update', 'daily_subject_write', 'teacher_history_daily_subject_select'],
  '날짜 기반 과목 기록 정책은 조회·입력·수정으로 구성된다'
);
select has_table('public', 'daily_record_publications', '학생·수업일 단위 보호자 공개 게이트 테이블이 존재한다');
select has_column('public', 'daily_attendance_records', 'save_state', '날짜별 출결에 임시·최종 저장상태가 존재한다');
select has_column('public', 'daily_subject_records', 'save_state', '날짜별 과목기록에 임시·최종 저장상태가 존재한다');
select has_column('public', 'daily_common_homework', 'save_state', '날짜별 공통숙제에 임시·최종 저장상태가 존재한다');
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'daily_record_publications'),
  'daily record publication gate has RLS enabled'
);
select policies_are(
  'public',
  'daily_record_publications',
  array['daily_record_publications_admin_select', 'daily_record_publications_guardian_select'],
  'publication gate is readable only by academy admins and entitled guardians'
);
select ok(
  not has_table_privilege('authenticated', 'public.daily_subject_records', 'INSERT'),
  'authenticated users cannot bypass the server-side daily-record save validation'
);
select ok(
  not has_table_privilege('authenticated', 'public.daily_subject_records', 'UPDATE'),
  'authenticated users cannot directly update daily subject records'
);
select ok(
  has_table_privilege('service_role', 'public.daily_subject_records', 'INSERT')
  and has_table_privilege('service_role', 'public.daily_subject_records', 'UPDATE'),
  'server service role can persist validated daily subject records'
);
select ok(
  to_regprocedure('private.guardian_can_view_published_daily_record(uuid,uuid,date)') is not null,
  'guardian daily-record policy uses the published student-day gate'
);

select has_column('public', 'attendance_records', 'subject_id', '출결 기록에 과목 범위가 존재한다');
select policies_are(
  'public',
  'attendance_records',
  array['attendance_insert', 'attendance_select', 'attendance_update', 'teacher_history_attendance_select'],
  '출결 정책은 과목 담당교사 범위로 구성된다'
);
select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'attendance_records'
      and indexname = 'attendance_records_subject_scope_uidx'
  ),
  '과목별 출결 고유 인덱스가 존재한다'
);

select has_table('public', 'academies', '학원 테이블이 존재한다');
select has_table('public', 'teacher_subject_records', '교사 과목기록 테이블이 존재한다');
select has_column('public', 'teacher_subject_records', 'is_supplementary', '교사 과목기록에 나머지·보충 플래그가 존재한다');
select has_table('public', 'test_definitions', '테스트 정의 테이블이 존재한다');
select has_table('public', 'student_test_results', '학생별 테스트 결과 테이블이 존재한다');
select has_table('public', 'teacher_accounts', '교사 계정 테이블이 존재한다');
select has_column('public', 'profiles', 'password_setup_required', '프로필에 최초 비밀번호 설정 상태가 있다');
select has_column('public', 'profiles', 'is_login_active', '프로필에 로그인 활성 상태가 있다');
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'teacher_accounts'),
  'teacher_accounts 테이블에 RLS가 활성화되어 있다'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'students'),
  'students 테이블에 RLS가 활성화되어 있다'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'test_definitions'),
  'test_definitions 테이블에 RLS가 활성화되어 있다'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'student_test_results'),
  'student_test_results 테이블에 RLS가 활성화되어 있다'
);
select policies_are(
  'public',
  'teacher_subject_records',
  array['subject_records_insert', 'subject_records_select', 'subject_records_update', 'teacher_history_subject_records_select'],
  '교사 과목기록 정책이 예상된 세 가지로 구성되어 있다'
);
select policies_are(
  'public',
  'test_definitions',
  array['teacher_history_test_definitions_select', 'test_definitions_access'],
  '테스트 정의 정책이 교사·운영자 접근으로 구성되어 있다'
);
select policies_are(
  'public',
  'student_test_results',
  array['student_test_results_insert', 'student_test_results_select', 'student_test_results_update', 'teacher_history_test_results_select'],
  '학생별 테스트 결과 정책이 조회·입력·수정으로 구성되어 있다'
);

select has_table('public', 'guardian_invites', 'guardian_invites table exists');
select has_table('public', 'guardian_devices', 'guardian_devices table exists');
select has_column('public', 'guardians', 'password_setup_required', 'guardians password setup flag exists');
select has_column('public', 'guardians', 'guardian_access_revoked_at', 'guardians access revocation timestamp exists');
select has_column('public', 'student_guardians', 'access_revoked_at', 'student guardian access revocation timestamp exists');
select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'guardian_devices'
      and indexname = 'guardian_devices_one_active_idx'
  ),
  'guardian devices have one-active-device index'
);
select has_column('public', 'publication_snapshots', 'value_json', 'publication snapshot value exists');
select has_column('public', 'guardian_invites', 'attempt_count', 'guardian invite attempt count exists');
select has_column('public', 'guardian_invites', 'locked_until', 'guardian invite lock timestamp exists');
select has_table('public', 'change_requests', 'change_requests table exists');
select has_table('public', 'audit_logs', 'audit_logs table exists');
select has_table('public', 'academy_setting_history', 'academy setting history table exists');
select has_column('public', 'academy_setting_history', 'setting_key', 'academy setting key exists');
select has_column('public', 'academy_setting_history', 'value_json', 'academy setting value exists');
select has_table('public', 'student_status_history', 'student_status_history table exists');
select has_table('public', 'schools', 'schools table exists');
select has_column('public', 'students', 'school_level', 'students school level exists');
select has_column('public', 'students', 'school_id', 'students school reference exists');
select has_column('public', 'students', 'guardian1_name', 'students guardian 1 name exists');
select has_column('public', 'students', 'guardian2_name', 'students guardian 2 name exists');
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'schools'),
  'schools has RLS enabled'
);
select policies_are(
  'public',
  'schools',
  array['schools_select', 'schools_manage'],
  'schools policies are academy-admin scoped'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'student_status_history'),
  'student_status_history has RLS enabled'
);
select policies_are(
  'public',
  'student_status_history',
  array['student_status_history_select', 'student_status_history_insert'],
  'student_status_history policies are admin read and append only insert'
);
select ok(
  exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'publication_bundles'
      and c.conname = 'publication_bundles_status_check'
      and pg_get_constraintdef(c.oid) like '%correction_requested%'
  ),
  'publication bundles support correction-request states'
);
select ok(
  exists (
    select 1
    from pg_trigger tr
    join pg_class t on t.oid = tr.tgrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'audit_logs'
      and tr.tgname = 'audit_logs_append_only'
      and not tr.tgisinternal
  ),
  'audit logs have an append-only trigger'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'guardian_devices'),
  'guardian_devices has RLS enabled'
);
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'academy_setting_history'),
  'academy_setting_history has RLS enabled'
);
select policies_are(
  'public',
  'academy_setting_history',
  array['academy_setting_history_select', 'academy_setting_history_insert'],
  'academy setting history is admin-scoped and insert-only'
);
select has_table('public', 'recurring_timetables', 'recurring timetables table exists');
select has_column('public', 'recurring_timetables', 'weekday', 'recurring timetable weekday exists');
select has_column('public', 'recurring_timetables', 'effective_start', 'recurring timetable effective start exists');
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'recurring_timetables'),
  'recurring timetables has RLS enabled'
);
select policies_are(
  'public',
  'recurring_timetables',
  array['recurring_timetables_select', 'recurring_timetables_manage'],
  'recurring timetables policies are academy-admin scoped'
);

insert into auth.users (id, email)
values
  ('10000000-0000-0000-0000-000000000001', 'academy-admin@test.invalid'),
  ('10000000-0000-0000-0000-000000000002', 'teacher-one@test.invalid'),
  ('10000000-0000-0000-0000-000000000003', 'teacher-two@test.invalid'),
  ('10000000-0000-0000-0000-000000000004', 'guardian-one@test.invalid'),
  ('10000000-0000-0000-0000-000000000005', 'system-admin@test.invalid');

insert into public.academies (id, name, status)
values ('20000000-0000-0000-0000-000000000001', '테스트 학원', 'active');

select is(
  public.next_student_no('20000000-0000-0000-0000-000000000001', '2026-09-23'::date),
  '202609001',
  '학생 번호는 등록 연월과 3자리 일련번호로 자동 생성된다'
);

insert into public.profiles (id, auth_user_id, display_name, email)
values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '테스트 운영자', 'academy-admin@test.invalid'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '테스트 교사 1', 'teacher-one@test.invalid'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', '테스트 교사 2', 'teacher-two@test.invalid'),
  ('30000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000005', '테스트 시스템 관리자', 'system-admin@test.invalid');

insert into public.academy_memberships (academy_id, profile_id, role, is_active)
values
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'academy_admin', true),
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'teacher', true),
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'teacher', true),
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000005', 'system_admin', true);

insert into public.school_years (id, academy_id, name, start_date, end_date)
values ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '2026학년도', '2026-03-01', '2027-02-28');

insert into public.terms (id, academy_id, school_year_id, name, start_date, end_date, is_current)
values ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '1학기', '2026-03-01', '2026-08-31', true);

insert into public.classes (id, academy_id, name, is_active)
values ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '테스트 A반', true);

insert into public.subjects (id, academy_id, name, is_active)
values ('40000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', '영어', true);

insert into public.recurring_timetables (
  id,
  academy_id,
  class_id,
  weekday,
  start_time,
  end_time,
  effective_start,
  effective_end
)
values (
  'a0000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000003',
  'tue',
  '18:00',
  '19:00',
  '2026-09-29',
  '2026-12-31'
);

insert into public.schools (id, academy_id, school_level, name, is_active)
values ('40000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001', 'middle', '테스트중학교', true);

insert into public.students (id, academy_id, student_no, name, school_level, school_id, grade, phone, registered_at, current_status)
values
  ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'TEST-001', '테스트 학생 1', 'middle', '40000000-0000-0000-0000-000000000005', '1', '010-4567-8912', '2026-03-01', 'enrolled'),
  ('50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'TEST-002', '테스트 학생 2', null, null, null, null, '2026-03-01', 'enrolled');

insert into public.class_sessions (id, academy_id, class_id, term_id, session_date, start_time, end_time, status, lead_teacher_id)
values ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000002', '2026-09-21', '18:00', '19:00', 'scheduled', '30000000-0000-0000-0000-000000000002');

insert into public.session_subject_assignments (academy_id, session_id, subject_id, teacher_id, subject_name_snapshot, teacher_name_snapshot, expected_status)
values ('20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000002', '영어', '테스트 교사 1', 'expected');

insert into public.session_student_rosters (academy_id, session_id, student_id, class_name_snapshot, is_expected)
values ('20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '테스트 A반', true);

insert into public.guardians (id, academy_id, auth_user_id, display_name, phone, email)
values ('70000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', '테스트 보호자', '010-4567-8912', 'guardian-one@test.invalid');

select is(
  (select school_name from public.students where id = '50000000-0000-0000-0000-000000000001'),
  '테스트중학교',
  'student school selection snapshots the configured school name'
);

insert into public.student_guardians (academy_id, student_id, guardian_id, relationship, is_active)
values ('20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', '보호자', true);

insert into public.publication_bundles (id, academy_id, student_id, session_id, status)
values ('80000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'published');

insert into public.class_sessions (id, academy_id, class_id, term_id, session_date, start_time, end_time, status, lead_teacher_id)
values ('60000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000002', '2026-09-22', '18:00', '19:00', 'scheduled', '30000000-0000-0000-0000-000000000002');

insert into public.publication_bundles (id, academy_id, student_id, session_id, status)
values ('80000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000003', 'ready');

insert into public.academies (id, name, status)
values ('21000000-0000-0000-0000-000000000001', '다른 테스트 학원', 'active');

insert into public.school_years (id, academy_id, name, start_date, end_date)
values ('41000000-0000-0000-0000-000000000006', '21000000-0000-0000-0000-000000000001', '2026학년도', '2026-03-01', '2027-02-28');

insert into public.terms (id, academy_id, school_year_id, name, start_date, end_date, is_current)
values ('41000000-0000-0000-0000-000000000007', '21000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000006', '1학기', '2026-03-01', '2026-08-31', true);

insert into public.classes (id, academy_id, name, is_active)
values ('41000000-0000-0000-0000-000000000008', '21000000-0000-0000-0000-000000000001', '다른 학원 A반', true);

insert into public.subjects (id, academy_id, name, is_active)
values ('41000000-0000-0000-0000-000000000009', '21000000-0000-0000-0000-000000000001', '다른 학원 영어', true);

insert into public.students (id, academy_id, student_no, name, registered_at, current_status)
values ('51000000-0000-0000-0000-000000000003', '21000000-0000-0000-0000-000000000001', 'OTHER-001', '다른 학원 학생', '2026-03-01', 'enrolled');

insert into public.class_sessions (id, academy_id, class_id, term_id, session_date, start_time, end_time, status, lead_teacher_id)
values ('61000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000008', '41000000-0000-0000-0000-000000000007', '2026-09-22', '18:00', '19:00', 'scheduled', '30000000-0000-0000-0000-000000000002');

insert into public.session_subject_assignments (academy_id, session_id, subject_id, teacher_id, subject_name_snapshot, teacher_name_snapshot, expected_status)
values ('21000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000002', '41000000-0000-0000-0000-000000000009', '30000000-0000-0000-0000-000000000002', '다른 학원 영어', '테스트 교사 1', 'expected');

insert into public.session_student_rosters (academy_id, session_id, student_id, class_name_snapshot, is_expected)
values ('21000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-000000000003', '다른 학원 A반', true);

insert into public.private_records (academy_id, student_id, record_type, content, author_profile_id)
values ('20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'risk_note', '테스트 비공개 기록', '30000000-0000-0000-0000-000000000002');

insert into public.student_status_history (
  academy_id,
  student_id,
  previous_status,
  next_status,
  effective_date,
  changed_by_profile_id,
  reason
)
values (
  '20000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  null,
  'enrolled',
  '2026-03-01',
  '30000000-0000-0000-0000-000000000001',
  '최초 등록'
);

insert into public.test_definitions (
  id,
  academy_id,
  session_id,
  subject_id,
  teacher_id,
  sequence_no,
  name,
  max_score
)
values (
  '90000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000004',
  '30000000-0000-0000-0000-000000000002',
  1,
  '단어 테스트',
  20
);

insert into public.student_test_results (
  academy_id,
  student_id,
  test_definition_id,
  score
)
values (
  '20000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000001',
  18
);

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::integer from public.recurring_timetables),
  1,
  '학원 운영자는 자기 academy의 반복 시간표를 조회한다'
);

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';

select is(
  (select count(*)::integer from public.students),
  1,
  '교사는 현재 배정된 학생 한 명만 조회한다'
);

select is(
  (select count(*)::integer from public.session_subject_assignments),
  1,
  '교사는 본인이 속한 academy의 회차 과목 배정만 조회한다'
);

select is(
  (select count(*)::integer from public.recurring_timetables),
  0,
  '교사는 반복 시간표를 직접 조회하지 못한다'
);

select is(
  (select count(*)::integer from public.test_definitions),
  1,
  '담당 교사는 본인이 담당한 테스트 정의만 조회한다'
);

select is(
  (select count(*)::integer from public.student_test_results),
  1,
  '담당 교사는 배정 학생의 테스트 결과만 조회한다'
);

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';

select is(
  (select count(*)::integer from public.test_definitions),
  0,
  '다른 교사는 테스트 정의를 조회하지 못한다'
);

select is(
  (select count(*)::integer from public.student_test_results),
  0,
  '다른 교사는 테스트 결과를 조회하지 못한다'
);

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000004';

select is(
  (select count(*)::integer from public.publication_bundles),
  1,
  '보호자는 연결된 공개완료 묶음만 조회한다'
);

select is(
  (select count(*)::integer from public.class_sessions),
  1,
  '보호자는 공개완료 묶음의 수업 회차만 조회한다'
);

select is(
  (select count(*)::integer from public.private_records),
  0,
  '보호자는 비공개기록을 조회하지 못한다'
);

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000005';

select is(
  (select count(*)::integer from public.students),
  0,
  '시스템 관리자는 학습기록 본문을 조회하지 못한다'
);

select is(
  (select count(*)::integer from public.test_definitions),
  0,
  '시스템 관리자는 테스트 정의를 조회하지 못한다'
);

select is(
  (select count(*)::integer from public.student_test_results),
  0,
  '시스템 관리자는 테스트 결과를 조회하지 못한다'
);

select is(
  (select count(*)::integer from public.student_status_history),
  0,
  '시스템 관리자는 학생 상태 이력을 조회하지 못한다'
);

select has_table('public', 'risk_rule_settings', 'risk rule settings table exists');
select has_table('public', 'student_risk_results', 'student risk results table exists');
select policies_are(
  'public',
  'risk_rule_settings',
  array['risk_rule_settings_admin'],
  'risk rule settings are admin scoped'
);
select policies_are(
  'public',
  'student_risk_results',
  array['student_risk_results_admin', 'student_risk_results_insert_admin', 'student_risk_results_update_admin'],
  'student risk results are admin scoped'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'risk_rule_settings'
      and indexname = 'risk_rule_settings_academy_idx'
  ),
  'risk rule settings academy index exists'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'student_risk_results'
      and indexname = 'student_risk_results_lookup_idx'
  ),
  'student risk results lookup index exists'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'risk_rule_settings_item_key_check'
      and pg_get_constraintdef(oid) like '%homework_score_low%'
  ),
  'teacher score fields are available as risk rule catalog items'
);

select * from finish();
rollback;
