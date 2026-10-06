begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

select ok(
  to_regprocedure('public.apply_exam_session_subject_batch(uuid,uuid,uuid,date,date,jsonb,uuid)') is not null,
  '내신 일괄배정 원자 트랜잭션 함수가 존재한다'
);

insert into auth.users (id, email)
values
  ('a1000000-0000-4000-8000-000000000001', 'exam-admin@test.invalid'),
  ('a1000000-0000-4000-8000-000000000002', 'exam-teacher@test.invalid');

insert into public.academies (id, name, status)
values ('a2000000-0000-4000-8000-000000000001', '일괄배정 테스트 학원', 'active');

insert into public.profiles (id, auth_user_id, display_name, email)
values
  ('a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', '테스트 관리자', 'exam-admin@test.invalid'),
  ('a3000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', '테스트 교사', 'exam-teacher@test.invalid');

insert into public.academy_memberships (academy_id, profile_id, role, is_active)
values
  ('a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'academy_admin', true),
  ('a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'teacher', true);

insert into public.school_years (id, academy_id, name, start_date, end_date)
values ('a4000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', '2099학년도', '2099-01-01', '2099-12-31');

insert into public.terms (id, academy_id, school_year_id, name, start_date, end_date, is_current)
values ('a4000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', '1학기', '2099-01-01', '2099-12-31', true);

insert into public.classes (id, academy_id, name, category, is_active)
values ('a4000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000001', '내신 테스트반', 'exam_prep', true);

insert into public.subjects (id, academy_id, name, is_active)
values ('a4000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000001', '영어', true);

insert into public.class_sessions (id, academy_id, class_id, term_id, session_date, start_time, end_time, status, lead_teacher_id)
values
  ('a6000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000002', '2099-02-01', '18:00', '19:00', 'scheduled', 'a3000000-0000-4000-8000-000000000002'),
  ('a6000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000002', '2099-02-02', '18:00', '19:00', 'scheduled', 'a3000000-0000-4000-8000-000000000002');

select is(
  (
    public.apply_exam_session_subject_batch(
      'a2000000-0000-4000-8000-000000000001',
      'a4000000-0000-4000-8000-000000000003',
      'a4000000-0000-4000-8000-000000000002',
      '2099-02-01',
      '2099-02-01',
      '[{"subjectId":"a4000000-0000-4000-8000-000000000004","teacherId":"a3000000-0000-4000-8000-000000000002"}]'::jsonb,
      'a3000000-0000-4000-8000-000000000001'
    ) ->> 'applied_count'
  ),
  '1',
  '유효한 미래 회차는 일괄배정된다'
);

select is(
  (select count(*)::integer from public.session_subject_assignments where session_id = 'a6000000-0000-4000-8000-000000000001'),
  1,
  '배정 행이 생성된다'
);

select is(
  (select count(*)::integer from public.audit_logs where target_id = 'a6000000-0000-4000-8000-000000000001'),
  1,
  '감사 로그가 같은 성공 트랜잭션에서 생성된다'
);

select throws_ok(
  $$select public.apply_exam_session_subject_batch(
    'a2000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000003',
    'a4000000-0000-4000-8000-000000000002',
    '2099-02-02',
    '2099-02-02',
    '[{"subjectId":"a4000000-0000-4000-8000-000000000004","teacherId":"a3000000-0000-4000-8000-000000000002"}]'::jsonb,
    'a3999999-0000-4000-8000-000000000099'
  )$$,
  '23503',
  null,
  '감사 로그 FK 오류가 함수 전체를 실패시킨다'
);

select is(
  (select count(*)::integer from public.session_subject_assignments where session_id = 'a6000000-0000-4000-8000-000000000002'),
  0,
  '감사 로그 오류 뒤 과목 배정도 자동 롤백된다'
);

select is(
  (select count(*)::integer from public.audit_logs where target_id = 'a6000000-0000-4000-8000-000000000002'),
  0,
  '실패한 회차의 감사 로그도 남지 않는다'
);

select * from finish();
rollback;
