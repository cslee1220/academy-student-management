-- Keep daily subject records and their supplementary task/event projection in
-- one database transaction. The existing core function remains reusable for
-- callers that do not need supplementary task synchronization.

begin;

create or replace function public.save_daily_records_with_supplements_transaction(
  p_academy_id uuid,
  p_block_id uuid,
  p_class_id uuid,
  p_record_date date,
  p_save_mode text,
  p_attendance_rows jsonb,
  p_subject_rows jsonb,
  p_homework jsonb,
  p_expected_block_ids uuid[],
  p_draft_student_ids uuid[],
  p_published_student_ids uuid[],
  p_actor_profile_id uuid,
  p_supplement_rows jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_core_result jsonb;
  v_row record;
  v_subject record;
  v_existing_task record;
  v_subject_found boolean;
  v_existing_task_found boolean;
  v_is_active boolean;
  v_status_changed boolean;
  v_cancellation_reason text := '수업기록에서 보충 대상 해제';
begin
  v_core_result := public.save_daily_records_transaction(
    p_academy_id,
    p_block_id,
    p_class_id,
    p_record_date,
    p_save_mode,
    p_attendance_rows,
    p_subject_rows,
    p_homework,
    p_expected_block_ids,
    p_draft_student_ids,
    p_published_student_ids,
    p_actor_profile_id
  );

  if p_supplement_rows is null then
    return v_core_result;
  end if;
  if jsonb_typeof(p_supplement_rows) <> 'array' then
    raise exception 'supplement rows must be an array' using errcode = '22023';
  end if;

  for v_row in
    select *
    from jsonb_to_recordset(p_supplement_rows) as item(
      student_id uuid,
      is_test_supplementary boolean,
      test_supplement_date date,
      test_items jsonb,
      is_homework_supplementary boolean,
      homework_supplement_date date,
      homework_content text,
      legacy_supplementary boolean
    )
  loop
    select
      dsr.id as source_subject_record_id,
      dsr.subject_id,
      dsr.teacher_id,
      dsr.student_id,
      block_row.class_id,
      block_row.class_name_snapshot,
      block_row.classroom_name_snapshot,
      dsr.subject_name_snapshot
    into v_subject
    from public.daily_subject_records dsr
    join public.class_schedule_blocks block_row
      on block_row.id = dsr.block_id
     and block_row.academy_id = dsr.academy_id
    where dsr.academy_id = p_academy_id
      and dsr.block_id = p_block_id
      and dsr.student_id = v_row.student_id
      and dsr.record_date = p_record_date;
    v_subject_found := found;

    if not v_subject_found then
      raise exception 'daily subject record was not found for supplementary task' using errcode = 'P0002';
    end if;

    v_is_active := coalesce(v_row.legacy_supplementary, false)
      or coalesce(v_row.is_test_supplementary, false)
      or coalesce(v_row.is_homework_supplementary, false);

    select *
    into v_existing_task
    from public.student_supplement_tasks
    where academy_id = p_academy_id
      and source_subject_record_id = v_subject.source_subject_record_id
    for update;
    v_existing_task_found := found;

    if not v_is_active and not v_existing_task_found then
      continue;
    end if;

    v_status_changed := v_existing_task_found and v_existing_task.is_active is distinct from v_is_active;

    if v_existing_task_found then
      update public.student_supplement_tasks
      set block_id = p_block_id,
          class_id = v_subject.class_id,
          subject_id = v_subject.subject_id,
          teacher_id = v_subject.teacher_id,
          student_id = v_subject.student_id,
          record_date = p_record_date,
          class_name_snapshot = v_subject.class_name_snapshot,
          subject_name_snapshot = v_subject.subject_name_snapshot,
          classroom_name_snapshot = v_subject.classroom_name_snapshot,
          is_active = v_is_active,
          legacy_supplementary = coalesce(v_row.legacy_supplementary, false),
          is_test_supplementary = coalesce(v_row.is_test_supplementary, false),
          test_supplement_date = v_row.test_supplement_date,
          test_items = coalesce(v_row.test_items, '[]'::jsonb),
          is_homework_supplementary = coalesce(v_row.is_homework_supplementary, false),
          homework_supplement_date = v_row.homework_supplement_date,
          homework_content = v_row.homework_content,
          cancelled_at = case when v_is_active then null else coalesce(v_existing_task.cancelled_at, now()) end,
          cancelled_by_profile_id = case
            when v_is_active then null
            when v_existing_task.is_active = false then v_existing_task.cancelled_by_profile_id
            else p_actor_profile_id
          end,
          cancel_reason = case when v_is_active then null else coalesce(v_existing_task.cancel_reason, v_cancellation_reason) end
      where id = v_existing_task.id;
    else
      insert into public.student_supplement_tasks (
        academy_id,
        source_subject_record_id,
        block_id,
        class_id,
        subject_id,
        teacher_id,
        student_id,
        record_date,
        class_name_snapshot,
        subject_name_snapshot,
        classroom_name_snapshot,
        is_active,
        legacy_supplementary,
        is_test_supplementary,
        test_supplement_date,
        test_items,
        is_homework_supplementary,
        homework_supplement_date,
        homework_content,
        created_by_profile_id
      ) values (
        p_academy_id,
        v_subject.source_subject_record_id,
        p_block_id,
        v_subject.class_id,
        v_subject.subject_id,
        v_subject.teacher_id,
        v_subject.student_id,
        p_record_date,
        v_subject.class_name_snapshot,
        v_subject.subject_name_snapshot,
        v_subject.classroom_name_snapshot,
        v_is_active,
        coalesce(v_row.legacy_supplementary, false),
        coalesce(v_row.is_test_supplementary, false),
        v_row.test_supplement_date,
        coalesce(v_row.test_items, '[]'::jsonb),
        coalesce(v_row.is_homework_supplementary, false),
        v_row.homework_supplement_date,
        v_row.homework_content,
        p_actor_profile_id
      );
    end if;

    if v_existing_task_found and v_status_changed then
      insert into public.student_supplement_task_events (
        academy_id,
        task_id,
        event_type,
        actor_profile_id,
        reason
      ) values (
        p_academy_id,
        v_existing_task.id,
        case when v_is_active then 'reopened' else 'cancelled' end,
        p_actor_profile_id,
        case when v_is_active then '수업기록에서 보충 대상 재지정' else v_cancellation_reason end
      );
    end if;
  end loop;

  return v_core_result || jsonb_build_object('supplement_tasks_transactional', true);
end;
$$;

revoke all on function public.save_daily_records_with_supplements_transaction(uuid, uuid, uuid, date, text, jsonb, jsonb, jsonb, uuid[], uuid[], uuid[], uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_daily_records_with_supplements_transaction(uuid, uuid, uuid, date, text, jsonb, jsonb, jsonb, uuid[], uuid[], uuid[], uuid, jsonb) to service_role;

commit;
