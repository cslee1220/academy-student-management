-- 내신 수업 회차 과목·담당교사 일괄 배정은 배정과 감사 로그를 하나의
-- 데이터베이스 트랜잭션으로 처리한다. RPC 호출 중 예외가 발생하면
-- PostgreSQL이 함수 호출 전체를 롤백한다.

create or replace function public.apply_exam_session_subject_batch(
  p_academy_id uuid,
  p_class_id uuid,
  p_term_id uuid,
  p_date_from date,
  p_date_to date,
  p_subject_assignments jsonb,
  p_actor_profile_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_class_name text;
  v_term_start date;
  v_term_end date;
  v_requested_count integer;
  v_total_count integer := 0;
  v_applied_count integer := 0;
  v_skipped_already_assigned_count integer := 0;
  v_skipped_locked_count integer := 0;
  v_assignment_count integer := 0;
  v_eligible_session_ids uuid[] := array[]::uuid[];
  v_session record;
  v_is_locked boolean;
  v_valid_subject_count integer;
  v_requested_assignments jsonb;
  v_assignments_json jsonb;
begin
  if p_date_from > p_date_to then
    raise exception using errcode = '22023', message = 'date range is invalid';
  end if;

  if p_date_from <= (now() at time zone 'Asia/Seoul')::date then
    raise exception using errcode = '22023', message = 'future sessions are required';
  end if;

  select c.name
    into v_class_name
  from public.classes c
  where c.id = p_class_id
    and c.academy_id = p_academy_id
    and c.is_active;

  if v_class_name is null then
    raise exception using errcode = '23503', message = 'active class was not found';
  end if;

  select t.start_date, t.end_date
    into v_term_start, v_term_end
  from public.terms t
  where t.id = p_term_id
    and t.academy_id = p_academy_id
    and not t.is_archived;

  if not found then
    raise exception using errcode = '23503', message = 'active term was not found';
  end if;

  if p_date_from < v_term_start or p_date_to > v_term_end then
    raise exception using errcode = '22023', message = 'date range is outside the term';
  end if;

  if jsonb_typeof(p_subject_assignments) <> 'array' then
    raise exception using errcode = '22023', message = 'subject assignments must be an array';
  end if;

  v_requested_count := jsonb_array_length(p_subject_assignments);
  if v_requested_count < 1 or v_requested_count > 20 then
    raise exception using errcode = '22023', message = 'subject assignments count is invalid';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_subject_assignments) item
    group by item ->> 'subjectId'
    having count(*) > 1
  ) then
    raise exception using errcode = '23505', message = 'duplicate subject assignment';
  end if;

  select count(*)
    into v_valid_subject_count
  from jsonb_array_elements(p_subject_assignments) item
  join public.subjects s
    on s.id = (item ->> 'subjectId')::uuid
   and s.academy_id = p_academy_id
   and s.is_active
  join public.profiles p
    on p.id = (item ->> 'teacherId')::uuid
  join public.academy_memberships am
    on am.academy_id = p_academy_id
   and am.profile_id = p.id
   and am.role = 'teacher'
   and am.is_active;

  if v_valid_subject_count <> v_requested_count then
    raise exception using errcode = '23503', message = 'active subject or teacher was not found';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'subject_id', (item ->> 'subjectId')::uuid,
      'subject_name', s.name,
      'teacher_id', (item ->> 'teacherId')::uuid,
      'teacher_name', p.display_name
    ) order by (item ->> 'subjectId')::uuid
  )
    into v_requested_assignments
  from jsonb_array_elements(p_subject_assignments) item
  join public.subjects s
    on s.id = (item ->> 'subjectId')::uuid
   and s.academy_id = p_academy_id
   and s.is_active
  join public.profiles p
    on p.id = (item ->> 'teacherId')::uuid
  join public.academy_memberships am
    on am.academy_id = p_academy_id
   and am.profile_id = p.id
   and am.role = 'teacher'
   and am.is_active;

  v_assignments_json := jsonb_build_object('assignments', v_requested_assignments);

  -- 수업 회차 행을 잠가 같은 반·기간의 동시 일괄배정이 서로 겹치지 않도록 한다.
  for v_session in
    select cs.id, cs.session_date
    from public.class_sessions cs
    where cs.academy_id = p_academy_id
      and cs.class_id = p_class_id
      and cs.term_id = p_term_id
      and cs.session_date between p_date_from and p_date_to
    order by cs.session_date, cs.start_time, cs.id
    for update
  loop
    v_total_count := v_total_count + 1;

    if exists (
      select 1
      from public.session_subject_assignments ssa
      where ssa.academy_id = p_academy_id
        and ssa.session_id = v_session.id
    ) then
      v_skipped_already_assigned_count := v_skipped_already_assigned_count + 1;
      continue;
    end if;

    v_is_locked := v_session.session_date <= (now() at time zone 'Asia/Seoul')::date;

    if not v_is_locked then
      v_is_locked := exists (
        select 1
        from public.teacher_subject_records tsr
        where tsr.academy_id = p_academy_id
          and tsr.session_id = v_session.id
          and (tsr.status = 'final' or tsr.first_final_saved_at is not null)
      ) or exists (
        select 1
        from public.attendance_records ar
        where ar.academy_id = p_academy_id
          and ar.session_id = v_session.id
          and ar.final_saved_at is not null
      ) or exists (
        select 1
        from public.common_homework ch
        where ch.academy_id = p_academy_id
          and ch.session_id = v_session.id
          and ch.final_saved_at is not null
      ) or exists (
        select 1
        from public.publication_bundles pb
        where pb.academy_id = p_academy_id
          and pb.session_id = v_session.id
          and pb.status <> 'drafting'
      );
    end if;

    if v_is_locked then
      v_skipped_locked_count := v_skipped_locked_count + 1;
    else
      v_eligible_session_ids := array_append(v_eligible_session_ids, v_session.id);
    end if;
  end loop;

  if coalesce(array_length(v_eligible_session_ids, 1), 0) > 0 then
    insert into public.session_subject_assignments (
      academy_id,
      session_id,
      subject_id,
      teacher_id,
      subject_name_snapshot,
      teacher_name_snapshot,
      expected_status
    )
    select
      p_academy_id,
      eligible.session_id,
      requested.subject_id,
      requested.teacher_id,
      requested.subject_name,
      requested.teacher_name,
      'expected'
    from unnest(v_eligible_session_ids) as eligible(session_id)
    cross join jsonb_to_recordset(v_requested_assignments) as requested(
      subject_id uuid,
      subject_name text,
      teacher_id uuid,
      teacher_name text
    );

    get diagnostics v_assignment_count = row_count;
    v_applied_count := cardinality(v_eligible_session_ids);

    insert into public.audit_logs (
      academy_id,
      target_table,
      target_id,
      field_key,
      old_value_json,
      new_value_json,
      reason,
      actor_profile_id
    )
    select
      p_academy_id,
      'class_sessions',
      eligible.session_id,
      'subject_assignments',
      null,
      v_assignments_json,
      format('%s 미래 수업 회차 과목·담당교사 일괄 배정', v_class_name),
      p_actor_profile_id
    from unnest(v_eligible_session_ids) as eligible(session_id);
  end if;

  return jsonb_build_object(
    'applied_count', v_applied_count,
    'skipped_already_assigned_count', v_skipped_already_assigned_count,
    'skipped_locked_count', v_skipped_locked_count,
    'assignment_count', v_assignment_count,
    'sessions', to_jsonb(coalesce(v_eligible_session_ids, array[]::uuid[]))
  );
end;
$$;

revoke all on function public.apply_exam_session_subject_batch(uuid, uuid, uuid, date, date, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.apply_exam_session_subject_batch(uuid, uuid, uuid, date, date, jsonb, uuid)
  to service_role;
