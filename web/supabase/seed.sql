-- Local demo data only. This file is loaded by `supabase db reset`.
begin;

-- Demo academy and one admin/teacher profile used as seeded ownership data.
insert into auth.users (
  id,
  instance_id,
  email,
  aud,
  role,
  encrypted_password,
  email_confirmed_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  ('11000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'demo-admin@test.invalid', 'authenticated', 'authenticated', crypt('DemoAdmin123!', gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('11000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 't-900001@auth.academy.invalid', 'authenticated', 'authenticated', crypt('DemoTeacher123!', gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into auth.users (
  id,
  instance_id,
  email,
  aud,
  role,
  email_confirmed_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
select
  format('11000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000',
  format('demo.guardian.%s@test.invalid', lpad((i - 100)::text, 2, '0')),
  'authenticated',
  'authenticated',
  now(),
  '',
  '',
  '',
  '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
from generate_series(101, 120) as series(i);

insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
select
  id::text,
  id,
  jsonb_build_object('sub', id::text, 'email', email),
  'email',
  now(),
  now()
from auth.users as seeded_user
where not exists (
  select 1
  from auth.identities as existing_identity
  where existing_identity.user_id = seeded_user.id
    and existing_identity.provider = 'email'
);

insert into public.academies (id, name, status)
values ('21000000-0000-4000-8000-000000000001', '데모 영어학원', 'active');

insert into public.profiles (id, auth_user_id, display_name, phone, email, password_setup_required, is_login_active)
values
  ('31000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '데모 운영자', '010-6000-9001', 'demo-admin@test.invalid', false, true),
  ('31000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000002', '데모 교사', '010-6000-9002', 't-900001@auth.academy.invalid', false, true);

insert into public.academy_memberships (academy_id, profile_id, role, is_active, activated_at)
values
  ('21000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', 'academy_admin', true, now()),
  ('21000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000002', 'teacher', true, now());

insert into public.teacher_accounts (
  id,
  academy_id,
  profile_id,
  auth_user_id,
  login_id,
  password_setup_required,
  is_login_active
)
values (
  '32000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000002',
  'T-900001',
  false,
  true
);

insert into public.school_years (id, academy_id, name, start_date, end_date)
values
  ('41000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '2026학년도', '2026-03-01', '2027-02-28');

insert into public.terms (id, academy_id, school_year_id, name, start_date, end_date, is_current)
values
  ('42000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', '1학기', '2026-03-01', '2026-08-31', false),
  ('42000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', '2학기', '2026-09-01', '2027-02-28', true);

insert into public.schools (id, academy_id, school_level, name, is_active)
values
  ('43000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'elementary', '데모초등학교', true),
  ('43000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000001', 'elementary', '한빛초등학교', true),
  ('43000000-0000-4000-8000-000000000003', '21000000-0000-4000-8000-000000000001', 'elementary', '새봄초등학교', true),
  ('43000000-0000-4000-8000-000000000004', '21000000-0000-4000-8000-000000000001', 'middle', '데모중학교', true),
  ('43000000-0000-4000-8000-000000000005', '21000000-0000-4000-8000-000000000001', 'middle', '한빛중학교', true),
  ('43000000-0000-4000-8000-000000000006', '21000000-0000-4000-8000-000000000001', 'middle', '새봄중학교', true),
  ('43000000-0000-4000-8000-000000000007', '21000000-0000-4000-8000-000000000001', 'high', '데모고등학교', true),
  ('43000000-0000-4000-8000-000000000008', '21000000-0000-4000-8000-000000000001', 'high', '한빛고등학교', true),
  ('43000000-0000-4000-8000-000000000009', '21000000-0000-4000-8000-000000000001', 'high', '새봄고등학교', true);

insert into public.academy_levels (id, academy_id, name, is_active, display_order)
values
  ('49000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '초급', true, 1),
  ('49000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000001', '중급', true, 2),
  ('49000000-0000-4000-8000-000000000003', '21000000-0000-4000-8000-000000000001', '고급', true, 3);

insert into public.classrooms (id, academy_id, name, is_active)
values
  ('48000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '1강의실', true),
  ('48000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000001', '2강의실', true);

insert into public.classes (id, academy_id, name, category, is_active)
values
  ('44000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '초등 A반', '초등', true),
  ('44000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000001', '중등 A반', '중등', true),
  ('44000000-0000-4000-8000-000000000003', '21000000-0000-4000-8000-000000000001', '중등 B반', '중등', true),
  ('44000000-0000-4000-8000-000000000004', '21000000-0000-4000-8000-000000000001', '고등 A반', '고등', true);

insert into public.classes (id, academy_id, name, category, is_active)
values
  ('44000000-0000-4000-8000-000000000005', '21000000-0000-4000-8000-000000000001', '내신 테스트반', 'exam_prep', true);

insert into public.subjects (id, academy_id, name, is_active)
values
  ('45000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '영어', true),
  ('45000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000001', '문법', true);

insert into public.subjects (id, academy_id, name, is_active)
values ('45000000-0000-4000-8000-000000000003', '21000000-0000-4000-8000-000000000001', '내신', true);

insert into public.students (
  id,
  academy_id,
  student_no,
  name,
  school_level,
  school_id,
  grade,
  guardian1_name,
  phone,
  phone_relationship,
  guardian2_name,
  phone2,
  phone2_relationship,
  registered_at,
  current_status
)
select
  format('51000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid,
  '21000000-0000-4000-8000-000000000001',
  format('DEMO-%s', lpad(i::text, 3, '0')),
  format('데모 학생 %s', lpad(i::text, 2, '0')),
  case when i <= 7 then 'elementary' when i <= 14 then 'middle' else 'high' end,
  format(
    '43000000-0000-4000-8000-%s',
    lpad(
      case when i <= 7 then (1 + ((i - 1) % 3)) when i <= 14 then (4 + ((i - 8) % 3)) else (7 + ((i - 15) % 3)) end::text,
      12,
      '0'
    )
  )::uuid,
  (((i - 1) % 6) + 1)::text,
  format('데모 보호자1 %s', lpad(i::text, 2, '0')),
  format('010-6000-%s', lpad(i::text, 4, '0')),
  (array['엄마', '아빠', '조부', '조모', '이모', '고모', '삼촌', '기타'])[((i - 1) % 8) + 1],
  case when i <= 10 then format('데모 보호자2 %s', lpad(i::text, 2, '0')) else null end,
  case when i <= 10 then format('010-6100-%s', lpad(i::text, 4, '0')) else null end,
  case when i <= 10 then (array['엄마', '아빠', '조부', '조모', '이모', '고모', '삼촌', '기타'])[(i % 8) + 1] else null end,
  '2026-09-01',
  'enrolled'
from generate_series(1, 20) as series(i);

insert into public.student_status_history (academy_id, student_id, previous_status, next_status, effective_date, changed_by_profile_id, reason)
select
  '21000000-0000-4000-8000-000000000001',
  format('51000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid,
  null,
  'enrolled',
  '2026-09-01',
  '31000000-0000-4000-8000-000000000001',
  '데모 학생 최초 등록'
from generate_series(1, 20) as series(i);

insert into public.academy_operation_types (id, academy_id, code, name, is_default, is_active, display_order)
values
  ('4a000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'regular', '정규 수업', true, true, 0),
  ('4a000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000001', 'exam_prep', '내신 대비', false, true, 10);

insert into public.student_class_assignments (id, academy_id, student_id, operation_type_id, class_id, term_id, start_date, status)
select
  format('47000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid,
  '21000000-0000-4000-8000-000000000001',
  format('51000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid,
  '4a000000-0000-4000-8000-000000000001',
  format('44000000-0000-4000-8000-%s', lpad((1 + ((i - 1) / 5))::text, 12, '0'))::uuid,
  '42000000-0000-4000-8000-000000000002',
  '2026-09-01',
  'active'
from generate_series(1, 20) as series(i);

insert into public.class_sessions (id, academy_id, class_id, term_id, session_date, start_time, end_time, status, lead_teacher_id)
select
  format('46000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid,
  '21000000-0000-4000-8000-000000000001',
  format('44000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid,
  '42000000-0000-4000-8000-000000000002',
  date '2026-09-24' + (i - 1),
  '18:00',
  '19:00',
  'scheduled',
  '31000000-0000-4000-8000-000000000002'
from generate_series(1, 4) as series(i);

insert into public.class_sessions (id, academy_id, class_id, term_id, session_date, start_time, end_time, status, lead_teacher_id)
values
  ('46000000-0000-4000-8000-000000000005', '21000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000005', '42000000-0000-4000-8000-000000000002', '2026-10-13', '18:00', '19:00', 'scheduled', '31000000-0000-4000-8000-000000000002'),
  ('46000000-0000-4000-8000-000000000006', '21000000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000005', '42000000-0000-4000-8000-000000000002', '2026-10-15', '18:00', '19:00', 'scheduled', '31000000-0000-4000-8000-000000000002');

insert into public.session_student_rosters (id, academy_id, session_id, student_id, class_name_snapshot, is_expected)
values
  ('48000000-0000-4000-8000-000000000021', '21000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000005', '51000000-0000-4000-8000-000000000001', '내신 테스트반', true),
  ('48000000-0000-4000-8000-000000000022', '21000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000006', '51000000-0000-4000-8000-000000000001', '내신 테스트반', true);

insert into public.session_subject_assignments (academy_id, session_id, subject_id, teacher_id, subject_name_snapshot, teacher_name_snapshot, expected_status)
select
  '21000000-0000-4000-8000-000000000001',
  format('46000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid,
  '45000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000002',
  '영어',
  '데모 교사',
  'expected'
from generate_series(1, 4) as series(i);

insert into public.session_student_rosters (id, academy_id, session_id, student_id, class_assignment_id, class_name_snapshot, is_expected)
select
  format('48000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid,
  '21000000-0000-4000-8000-000000000001',
  format('46000000-0000-4000-8000-%s', lpad((1 + ((i - 1) / 5))::text, 12, '0'))::uuid,
  format('51000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid,
  format('47000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid,
  case when i <= 5 then '초등 A반' when i <= 10 then '중등 A반' when i <= 15 then '중등 B반' else '고등 A반' end,
  true
from generate_series(1, 20) as series(i);

insert into public.test_definitions (id, academy_id, session_id, subject_id, teacher_id, sequence_no, name, max_score)
select
  format('49000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid,
  '21000000-0000-4000-8000-000000000001',
  format('46000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid,
  '45000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000002',
  1,
  '단어 테스트',
  20
from generate_series(1, 4) as series(i);

insert into public.guardians (id, academy_id, auth_user_id, display_name, phone, email, password_setup_required, is_login_active)
select
  format('71000000-0000-4000-8000-%s', lpad((i - 100)::text, 12, '0'))::uuid,
  '21000000-0000-4000-8000-000000000001',
  format('11000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid,
  format('데모 보호자 %s', lpad((i - 100)::text, 2, '0')),
  format('010-7000-%s', lpad((i - 100)::text, 4, '0')),
  format('demo.guardian.%s@test.invalid', lpad((i - 100)::text, 2, '0')),
  true,
  true
from generate_series(101, 120) as series(i);

insert into public.student_guardians (id, academy_id, student_id, guardian_id, relationship, is_active)
select
  format('72000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid,
  '21000000-0000-4000-8000-000000000001',
  format('51000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid,
  format('71000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid,
  (array['엄마', '아빠', '조부', '조모', '이모', '고모', '삼촌', '기타'])[((i - 1) % 8) + 1],
  true
from generate_series(1, 20) as series(i);

insert into public.guardian_invites (
  id,
  academy_id,
  student_id,
  guardian_id,
  invite_token_hash,
  auth_code_hash,
  expires_at,
  created_by_profile_id
)
select
  format('73000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid,
  '21000000-0000-4000-8000-000000000001',
  format('51000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid,
  format('71000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid,
  encode(digest(format('demo-invite-token-%s', lpad(i::text, 2, '0')), 'sha256'), 'hex'),
  encode(digest(format('9000%s', lpad(i::text, 4, '0')), 'sha256'), 'hex'),
  '2026-12-31 23:59:59+09',
  '31000000-0000-4000-8000-000000000001'
from generate_series(1, 20) as series(i);

commit;
