begin;

-- The teacher UI no longer edits homework supplement content.  Keep the
-- legacy subject value when a task is created, but never update an existing
-- task's homework_content from a hidden client value.  Completion/date edits
-- still use the task version supplied by the current records read.
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
  v_cancellation_reason text := '수업기록에서 보충 설정 해제';
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
      task_version integer,
      legacy_supplementary boolean
    )
  loop
    select
      dsr.id as source_subject_record_id,
      dsr.subject_id,
      dsr.teacher_id,
      dsr.student_id,
      dsr.homework_supplement_content,
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

    if v_existing_task_found and v_row.task_version is not null
      and v_existing_task.version is distinct from v_row.task_version then
      raise exception 'supplement task version conflict' using errcode = '40001';
    end if;
    if not v_existing_task_found and v_row.task_version is not null
      and v_row.task_version <> 0 then
      raise exception 'supplement task version conflict' using errcode = '40001';
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
          cancelled_at = case when v_is_active then null else coalesce(v_existing_task.cancelled_at, now()) end,
          cancelled_by_profile_id = case
            when v_is_active then null
            when v_existing_task.is_active = false then v_existing_task.cancelled_by_profile_id
            else p_actor_profile_id
          end,
          cancel_reason = case when v_is_active then null else coalesce(v_existing_task.cancel_reason, v_cancellation_reason) end
      where id = v_existing_task.id
        and (v_row.task_version is null or version = v_row.task_version);
      if not found then
        raise exception 'supplement task version conflict' using errcode = '40001';
      end if;
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
        v_subject.homework_supplement_content,
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
        case when v_is_active then '수업기록에서 보충 설정' else v_cancellation_reason end
      );
    end if;
  end loop;

  return v_core_result || jsonb_build_object('supplement_tasks_transactional', true);
end;
$$;

revoke all on function public.save_daily_records_with_supplements_transaction(uuid, uuid, uuid, date, text, jsonb, jsonb, jsonb, uuid[], uuid[], uuid[], uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_daily_records_with_supplements_transaction(uuid, uuid, uuid, date, text, jsonb, jsonb, jsonb, uuid[], uuid[], uuid[], uuid, jsonb) to service_role;

-- Settings, history, and audit rows are committed together.  The API passes a
-- form-shaped history value, while the old value is always taken from the
-- locked database row so an actor cannot forge the audit baseline.
create or replace function public.save_academy_lesson_record_settings_transaction(
  p_academy_id uuid,
  p_expected_version integer,
  p_tests_enabled boolean,
  p_student_memo_enabled boolean,
  p_common_record_enabled boolean,
  p_metrics jsonb,
  p_supplement_types jsonb,
  p_actor_profile_id uuid,
  p_old_value_json jsonb,
  p_new_value_json jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_current public.academy_lesson_record_settings%rowtype;
  v_updated public.academy_lesson_record_settings%rowtype;
begin
  if not exists (
    select 1
    from public.academy_memberships membership
    where membership.academy_id = p_academy_id
      and membership.profile_id = p_actor_profile_id
      and membership.role = 'academy_admin'
      and membership.is_active
  ) then
    raise exception 'academy admin actor is not a member of academy' using errcode = '42501';
  end if;

  select * into v_current
  from public.academy_lesson_record_settings
  where academy_id = p_academy_id
  for update;
  if not found or v_current.version is distinct from p_expected_version then
    raise exception 'lesson record settings version conflict' using errcode = '40001';
  end if;
  if jsonb_typeof(coalesce(p_metrics, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_supplement_types, '[]'::jsonb)) <> 'array' then
    raise exception 'lesson record setting items must be arrays' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(coalesce(p_metrics, '[]'::jsonb)) item where coalesce((item ->> 'isActive')::boolean, false)) > 4 then
    raise exception 'active metrics limit exceeded' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(coalesce(p_supplement_types, '[]'::jsonb)) item where coalesce((item ->> 'isActive')::boolean, false)) > 3 then
    raise exception 'active supplement types limit exceeded' using errcode = '22023';
  end if;

  update public.academy_lesson_record_settings
  set tests_enabled = p_tests_enabled,
      student_memo_enabled = p_student_memo_enabled,
      common_record_enabled = p_common_record_enabled,
      metrics = coalesce(p_metrics, '[]'::jsonb),
      supplement_types = coalesce(p_supplement_types, '[]'::jsonb),
      version = v_current.version + 1,
      updated_by_profile_id = p_actor_profile_id,
      updated_at = now()
  where academy_id = p_academy_id
  returning * into v_updated;

  insert into public.academy_setting_history (academy_id, setting_key, value_json, changed_by_profile_id)
  values (p_academy_id, 'lesson_record.form', coalesce(p_new_value_json, '{}'::jsonb), p_actor_profile_id);

  insert into public.audit_logs (
    academy_id, target_table, target_id, field_key, old_value_json, new_value_json, reason, actor_profile_id
  ) values (
    p_academy_id,
    'academy_lesson_record_settings',
    p_academy_id,
    'form',
    to_jsonb(v_current),
    coalesce(p_new_value_json, '{}'::jsonb),
    p_reason,
    p_actor_profile_id
  );

  return to_jsonb(v_updated);
end;
$$;

revoke all on function public.save_academy_lesson_record_settings_transaction(uuid, integer, boolean, boolean, boolean, jsonb, jsonb, uuid, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.save_academy_lesson_record_settings_transaction(uuid, integer, boolean, boolean, boolean, jsonb, jsonb, uuid, jsonb, jsonb, text) to service_role;

-- Review rows are academy-admin writable, but the reviewed teacher must also
-- be an active teacher in the same academy.  Scope columns cannot be moved by
-- UPDATE even when a caller has an otherwise valid admin session.
create or replace function private.prevent_teacher_record_admin_review_scope_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.academy_id is distinct from old.academy_id
    or new.teacher_id is distinct from old.teacher_id then
    raise exception 'teacher review scope cannot change' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists daily_teacher_record_admin_reviews_scope_guard on public.daily_teacher_record_admin_reviews;
create trigger daily_teacher_record_admin_reviews_scope_guard
before update on public.daily_teacher_record_admin_reviews
for each row execute function private.prevent_teacher_record_admin_review_scope_change();

drop policy if exists daily_teacher_record_admin_reviews_select on public.daily_teacher_record_admin_reviews;
create policy daily_teacher_record_admin_reviews_select
on public.daily_teacher_record_admin_reviews
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  and exists (
    select 1 from public.academy_memberships teacher_membership
    where teacher_membership.academy_id = daily_teacher_record_admin_reviews.academy_id
      and teacher_membership.profile_id = daily_teacher_record_admin_reviews.teacher_id
      and teacher_membership.role = 'teacher'
      and teacher_membership.is_active
  )
);

drop policy if exists daily_teacher_record_admin_reviews_insert on public.daily_teacher_record_admin_reviews;
create policy daily_teacher_record_admin_reviews_insert
on public.daily_teacher_record_admin_reviews
for insert to authenticated
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  and updated_by_profile_id = private.current_profile_id()
  and exists (
    select 1 from public.academy_memberships teacher_membership
    where teacher_membership.academy_id = daily_teacher_record_admin_reviews.academy_id
      and teacher_membership.profile_id = daily_teacher_record_admin_reviews.teacher_id
      and teacher_membership.role = 'teacher'
      and teacher_membership.is_active
  )
);

drop policy if exists daily_teacher_record_admin_reviews_update on public.daily_teacher_record_admin_reviews;
create policy daily_teacher_record_admin_reviews_update
on public.daily_teacher_record_admin_reviews
for update to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  and exists (
    select 1 from public.academy_memberships teacher_membership
    where teacher_membership.academy_id = daily_teacher_record_admin_reviews.academy_id
      and teacher_membership.profile_id = daily_teacher_record_admin_reviews.teacher_id
      and teacher_membership.role = 'teacher'
      and teacher_membership.is_active
  )
)
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  and updated_by_profile_id = private.current_profile_id()
  and exists (
    select 1 from public.academy_memberships teacher_membership
    where teacher_membership.academy_id = daily_teacher_record_admin_reviews.academy_id
      and teacher_membership.profile_id = daily_teacher_record_admin_reviews.teacher_id
      and teacher_membership.role = 'teacher'
      and teacher_membership.is_active
  )
);

commit;
