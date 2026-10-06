begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

insert into public.school_years (id, academy_id, name, start_date, end_date)
values ('b4000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '보호 테스트 학년도', '2098-01-01', '2098-12-31');

insert into public.terms (id, academy_id, school_year_id, name, start_date, end_date, is_current)
values ('b4000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001', '보호 테스트 학기', '2098-01-01', '2098-12-31', false);

insert into public.classes (id, academy_id, name, category, is_active)
values ('b4000000-0000-4000-8000-000000000003', '21000000-0000-4000-8000-000000000001', '보호 테스트 반', 'test', true);

insert into public.students (id, academy_id, student_no, name, registered_at, current_status)
values ('b4000000-0000-4000-8000-000000000004', '21000000-0000-4000-8000-000000000001', 'TEST-DELETE-GUARD', '삭제 보호 테스트 학생', '2098-01-01', 'enrolled');

insert into public.student_class_assignments (id, academy_id, student_id, operation_type_id, class_id, term_id, start_date, status)
values ('b4000000-0000-4000-8000-000000000005', '21000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000004', '4a000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000003', 'b4000000-0000-4000-8000-000000000002', '2098-01-01', 'active');

select throws_ok(
  $$delete from public.terms where id = 'b4000000-0000-4000-8000-000000000002'$$,
  '23514',
  null,
  '학생 반 배정이 연결된 학기는 삭제할 수 없다'
);

select throws_ok(
  $$delete from public.school_years where id = 'b4000000-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  '학생 반 배정이 연결된 학년도는 삭제할 수 없다'
);

select is(
  (select count(*)::integer from public.students where id = 'b4000000-0000-4000-8000-000000000004'),
  1,
  '삭제 차단 검사 중 테스트 학생 행은 보존된다'
);

select is(
  (select count(*)::integer from public.student_class_assignments where id = 'b4000000-0000-4000-8000-000000000005'),
  1,
  '삭제 차단 검사 중 학생 반 배정 행은 보존된다'
);

select * from finish();
rollback;
