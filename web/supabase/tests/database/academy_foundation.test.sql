begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select has_table('public', 'academies', '학원 테이블이 존재한다');
select has_table('public', 'teacher_subject_records', '교사 과목기록 테이블이 존재한다');
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'students'),
  'students 테이블에 RLS가 활성화되어 있다'
);
select policies_are(
  'public',
  'teacher_subject_records',
  array['subject_records_select', 'subject_records_insert', 'subject_records_update'],
  '교사 과목기록 정책이 예상된 세 가지로 구성되어 있다'
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

insert into public.students (id, academy_id, student_no, name, registered_at, current_status)
values
  ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'TEST-001', '테스트 학생 1', '2026-03-01', 'enrolled'),
  ('50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'TEST-002', '테스트 학생 2', '2026-03-01', 'enrolled');

insert into public.class_sessions (id, academy_id, class_id, term_id, session_date, start_time, end_time, status, lead_teacher_id)
values ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000002', '2026-09-21', '18:00', '19:00', 'scheduled', '30000000-0000-0000-0000-000000000002');

insert into public.session_subject_assignments (academy_id, session_id, subject_id, teacher_id, subject_name_snapshot, teacher_name_snapshot, expected_status)
values ('20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000002', '영어', '테스트 교사 1', 'expected');

insert into public.session_student_rosters (academy_id, session_id, student_id, class_name_snapshot, is_expected)
values ('20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '테스트 A반', true);

insert into public.guardians (id, academy_id, auth_user_id, display_name, email)
values ('70000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', '테스트 보호자', 'guardian-one@test.invalid');

insert into public.student_guardians (academy_id, student_id, guardian_id, relationship, is_active)
values ('20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', '보호자', true);

insert into public.publication_bundles (id, academy_id, student_id, session_id, status)
values ('80000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'published');

insert into public.private_records (academy_id, student_id, record_type, content, author_profile_id)
values ('20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'risk_note', '테스트 비공개 기록', '30000000-0000-0000-0000-000000000002');

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';

select is(
  (select count(*)::integer from public.students),
  1,
  '교사는 현재 배정된 학생 한 명만 조회한다'
);

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000004';

select is(
  (select count(*)::integer from public.publication_bundles),
  1,
  '보호자는 연결된 공개완료 묶음만 조회한다'
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

select * from finish();
rollback;
