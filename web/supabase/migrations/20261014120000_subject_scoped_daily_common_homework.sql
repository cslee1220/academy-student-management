begin;

alter table public.daily_common_homework
  add column if not exists subject_id uuid references public.subjects(id) on delete restrict;

alter table public.daily_common_homework
  drop constraint if exists daily_common_homework_scope_key;

alter table public.daily_common_homework
  add constraint daily_common_homework_scope_key
  unique (academy_id, class_id, record_date, subject_id, operation_group);

create index if not exists daily_common_homework_subject_id_idx
  on public.daily_common_homework (subject_id);

create or replace function private.guardian_can_view_daily_homework_subject(
  p_academy_id uuid,
  p_class_id uuid,
  p_record_date date,
  p_operation_group text,
  p_subject_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select exists (
    select 1
    from public.class_schedule_blocks blocks
    join public.class_schedule_block_students block_students
      on block_students.block_id = blocks.id
     and block_students.academy_id = p_academy_id
     and block_students.is_active
     and p_record_date between block_students.start_date and coalesce(block_students.end_date, p_record_date)
     and (p_operation_group = 'common' or block_students.operation_group = p_operation_group)
    where blocks.academy_id = p_academy_id
      and blocks.class_id = p_class_id
      and blocks.is_active
      and blocks.subject_id = p_subject_id
      and p_record_date between blocks.effective_start and blocks.effective_end
      and private.guardian_can_view_published_daily_record(p_academy_id, block_students.student_id, p_record_date)
  );
$$;

grant execute on function private.guardian_can_view_daily_homework_subject(uuid, uuid, date, text, uuid) to authenticated;

drop policy if exists daily_homework_access on public.daily_common_homework;
create policy daily_homework_access on public.daily_common_homework
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_access_class_on_date(academy_id, class_id, record_date)
  or (
    save_state = 'final'
    and (
      (subject_id is null and private.guardian_can_view_daily_homework_group(academy_id, class_id, record_date, operation_group))
      or (subject_id is not null and private.guardian_can_view_daily_homework_subject(academy_id, class_id, record_date, operation_group, subject_id))
    )
  )
);

create or replace function public.save_daily_records_with_grouped_homework_transaction(
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
  v_homework_key text;
  v_homework_value jsonb;
  v_operation_group text;
  v_subject_id uuid;
  v_content text;
  v_no_homework boolean;
  v_expected_version integer;
  v_existing_homework public.daily_common_homework%rowtype;
  v_homework_saved_count integer := 0;
  v_seen_groups text[] := array[]::text[];
begin
  v_core_result := public.save_daily_records_with_supplements_transaction(
    p_academy_id,
    p_block_id,
    p_class_id,
    p_record_date,
    p_save_mode,
    p_attendance_rows,
    p_subject_rows,
    null,
    p_expected_block_ids,
    p_draft_student_ids,
    p_published_student_ids,
    p_actor_profile_id,
    p_supplement_rows
  );

  if p_homework is null then
    return v_core_result || jsonb_build_object('grouped_homework_saved_count', 0);
  end if;
  if jsonb_typeof(p_homework) <> 'object' then
    raise exception 'grouped homework must be an object' using errcode = '22023';
  end if;

  select subject_id
  into v_subject_id
  from public.class_schedule_blocks
  where id = p_block_id
    and academy_id = p_academy_id
    and class_id = p_class_id;
  if v_subject_id is null then
    raise exception 'daily homework subject scope is missing' using errcode = '22023';
  end if;

  -- Serialize subject-scoped homework writes for the same class/date.
  perform 1
  from public.classes
  where id = p_class_id
    and academy_id = p_academy_id
  for update;

  for v_homework_key, v_homework_value in
    select key, value
    from jsonb_each(p_homework)
  loop
    v_operation_group := case v_homework_key
      when 'A' then 'A'
      when 'B' then 'B'
      when 'common' then 'common'
      when 'unassigned' then 'common'
      else null
    end;
    if v_operation_group is null then
      raise exception 'invalid grouped homework operation group' using errcode = '22023';
    end if;
    if v_operation_group = any(v_seen_groups) then
      raise exception 'duplicate grouped homework operation group' using errcode = '22023';
    end if;
    v_seen_groups := array_append(v_seen_groups, v_operation_group);

    select row_data.content, coalesce(row_data.no_homework, false), row_data.version
    into v_content, v_no_homework, v_expected_version
    from jsonb_to_record(v_homework_value) as row_data(
      content text,
      no_homework boolean,
      version integer
    );

    select *
    into v_existing_homework
    from public.daily_common_homework
    where academy_id = p_academy_id
      and class_id = p_class_id
      and record_date = p_record_date
      and subject_id = v_subject_id
      and operation_group = v_operation_group
    for update;

    if found then
      if v_expected_version is not null and v_existing_homework.version is distinct from v_expected_version then
        raise exception 'daily common homework version conflict' using errcode = '40001';
      end if;
      update public.daily_common_homework
      set content = v_content,
          no_homework = v_no_homework,
          save_state = p_save_mode,
          version = v_existing_homework.version + 1
      where id = v_existing_homework.id;
    else
      if v_expected_version is not null and v_expected_version <> 0 then
        raise exception 'daily common homework version conflict' using errcode = '40001';
      end if;
      insert into public.daily_common_homework (
        academy_id, class_id, subject_id, record_date, operation_group, content, no_homework, save_state, version
      ) values (
        p_academy_id, p_class_id, v_subject_id, p_record_date, v_operation_group, v_content, v_no_homework, p_save_mode, 1
      );
    end if;
    v_homework_saved_count := v_homework_saved_count + 1;
  end loop;

  return v_core_result || jsonb_build_object('grouped_homework_saved_count', v_homework_saved_count);
end;
$$;

revoke all on function public.save_daily_records_with_grouped_homework_transaction(uuid, uuid, uuid, date, text, jsonb, jsonb, jsonb, uuid[], uuid[], uuid[], uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_daily_records_with_grouped_homework_transaction(uuid, uuid, uuid, date, text, jsonb, jsonb, jsonb, uuid[], uuid[], uuid[], uuid, jsonb) to service_role;

commit;
