-- Existing active class assignments are historical data and must not be deleted
-- during cleanup. For the same academy, student, term and operation type, keep
-- the latest start date; ties use updated_at and then id. Close every older
-- overlapping row while preserving its audit trail.

create or replace function private.cleanup_overlapping_student_class_assignments()
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_cleanup_rows jsonb;
  v_changed_count integer := 0;
begin
  select coalesce(jsonb_agg(to_jsonb(cleanup)), '[]'::jsonb)
    into v_cleanup_rows
  from (
    select distinct on (loser.id)
      loser.id as loser_id,
      loser.academy_id,
      loser.student_id,
      loser.term_id,
      loser.operation_type_id,
      loser.class_id as loser_class_id,
      winner.id as winner_id,
      winner.class_id as winner_class_id,
      loser.start_date as loser_start_date,
      loser.end_date as loser_end_date,
      case
        when loser.start_date = winner.start_date then loser.start_date
        else winner.start_date - 1
      end as cleanup_end_date,
      loser.status as loser_status
    from public.student_class_assignments loser
    join public.student_class_assignments winner
      on winner.id <> loser.id
     and winner.academy_id = loser.academy_id
     and winner.student_id = loser.student_id
     and winner.term_id = loser.term_id
     and winner.operation_type_id = loser.operation_type_id
     and winner.status = 'active'
     and loser.status = 'active'
     and loser.start_date <= coalesce(winner.end_date, '9999-12-31'::date)
     and winner.start_date <= coalesce(loser.end_date, '9999-12-31'::date)
     and (
       winner.start_date > loser.start_date
       or (winner.start_date = loser.start_date and winner.updated_at > loser.updated_at)
       or (winner.start_date = loser.start_date and winner.updated_at = loser.updated_at and winner.id > loser.id)
     )
    order by loser.id, winner.start_date desc, winner.updated_at desc, winner.id desc
  ) cleanup;

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
      cleanup.academy_id,
      'student_class_assignments',
      cleanup.loser_id,
      'overlap_cleanup',
      jsonb_build_object(
        'class_id', cleanup.loser_class_id,
        'start_date', cleanup.loser_start_date,
        'end_date', cleanup.loser_end_date,
        'status', cleanup.loser_status
      ),
      jsonb_build_object(
        'class_id', cleanup.loser_class_id,
        'start_date', cleanup.loser_start_date,
        'end_date', cleanup.cleanup_end_date,
        'status', 'ended',
        'winner_assignment_id', cleanup.winner_id,
        'winner_class_id', cleanup.winner_class_id
      ),
      '겹치는 기존 반 배정을 최신 시작일 기준으로 정리했습니다.',
      actors.actor_profile_id
    from jsonb_to_recordset(v_cleanup_rows) as cleanup(
      loser_id uuid,
      academy_id uuid,
      student_id uuid,
      term_id uuid,
      operation_type_id uuid,
      loser_class_id uuid,
      winner_id uuid,
      winner_class_id uuid,
      loser_start_date date,
      loser_end_date date,
      cleanup_end_date date,
      loser_status text
    )
    join lateral (
      select am.profile_id as actor_profile_id
      from public.academy_memberships am
      where am.academy_id = cleanup.academy_id
        and am.role = 'academy_admin'
        and am.is_active
      order by am.profile_id
      limit 1
    ) actors on actors.actor_profile_id is not null;

  update public.student_class_assignments assignment
  set status = 'ended',
      end_date = cleanup.cleanup_end_date,
      updated_at = now()
  from jsonb_to_recordset(v_cleanup_rows) as cleanup(
    loser_id uuid,
    cleanup_end_date date
  )
  where assignment.id = cleanup.loser_id
    and assignment.status = 'active';

  get diagnostics v_changed_count = row_count;
  return v_changed_count;
end;
$$;

revoke all on function private.cleanup_overlapping_student_class_assignments() from public, anon, authenticated;

select private.cleanup_overlapping_student_class_assignments();
