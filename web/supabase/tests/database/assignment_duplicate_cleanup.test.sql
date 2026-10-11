begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

select ok(
  to_regprocedure('private.cleanup_overlapping_student_class_assignments()') is not null,
  '중복 반 배정 정리 함수가 존재한다'
);

insert into public.student_class_assignments (
  id,
  academy_id,
  student_id,
  operation_type_id,
  class_id,
  term_id,
  start_date,
  end_date,
  status,
  assignment_role
)
values
  ('47000000-0000-4000-8000-000000000021', '21000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', '4a000000-0000-4000-8000-000000000002', '44000000-0000-4000-8000-000000000005', '42000000-0000-4000-8000-000000000002', '2026-11-10', '2026-11-30', 'active', 'exam'),
  ('47000000-0000-4000-8000-000000000022', '21000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', '4a000000-0000-4000-8000-000000000002', '44000000-0000-4000-8000-000000000004', '42000000-0000-4000-8000-000000000002', '2026-11-15', '2026-11-30', 'active', 'exam');

select is(
  private.cleanup_overlapping_student_class_assignments(),
  1,
  '겹치는 배정 중 오래된 행 하나만 정리한다'
);

select is(
  (select status from public.student_class_assignments where id = '47000000-0000-4000-8000-000000000021'),
  'ended',
  '이전 시작일 배정은 ended로 보존된다'
);

select is(
  (select end_date from public.student_class_assignments where id = '47000000-0000-4000-8000-000000000021'),
  '2026-11-14'::date,
  '이전 배정은 정본 시작일 전날에 종료된다'
);

select is(
  (select count(*)::integer from public.student_class_assignments where id = '47000000-0000-4000-8000-000000000022' and status = 'active'),
  1,
  '최신 시작일 배정은 active 정본으로 남는다'
);

select is(
  (select count(*)::integer from public.audit_logs where target_table = 'student_class_assignments' and target_id = '47000000-0000-4000-8000-000000000021' and field_key = 'overlap_cleanup'),
  1,
  '중복 정리 이력이 감사 로그에 남는다'
);

select * from finish();
rollback;
