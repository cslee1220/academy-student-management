begin;

alter table public.daily_common_homework
  add column if not exists lesson_content text;

create table public.daily_common_homework_publication_snapshots (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  record_date date not null,
  class_id uuid not null references public.classes(id) on delete restrict,
  daily_common_homework_id uuid not null,
  subject_id uuid,
  operation_group text not null,
  subject_name_snapshot text,
  lesson_content text,
  homework_content text,
  no_homework boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_common_homework_publication_snapshots_scope_key
    unique (academy_id, student_id, record_date, daily_common_homework_id)
);

create index daily_common_homework_publication_snapshots_student_date_idx
  on public.daily_common_homework_publication_snapshots (academy_id, student_id, record_date);

alter table public.daily_common_homework_publication_snapshots enable row level security;
revoke all on table public.daily_common_homework_publication_snapshots from public, anon, authenticated;
grant select, insert, update on table public.daily_common_homework_publication_snapshots to service_role;

create or replace function private.refresh_daily_common_homework_publication_snapshots(
  p_academy_id uuid,
  p_record_date date,
  p_student_id uuid default null,
  p_class_id uuid default null
)
returns void
language sql
security invoker
set search_path = public, private, pg_temp
as $$
  insert into public.daily_common_homework_publication_snapshots (
    academy_id,
    student_id,
    record_date,
    class_id,
    daily_common_homework_id,
    subject_id,
    operation_group,
    subject_name_snapshot,
    lesson_content,
    homework_content,
    no_homework
  )
  select distinct on (publication.academy_id, publication.student_id, publication.record_date, homework.id)
    publication.academy_id,
    publication.student_id,
    publication.record_date,
    homework.class_id,
    homework.id,
    homework.subject_id,
    homework.operation_group,
    case when homework.subject_id is null then null else block.subject_name_snapshot end,
    homework.lesson_content,
    homework.content,
    homework.no_homework
  from public.daily_record_publications publication
  join public.class_schedule_block_students block_student
    on block_student.academy_id = publication.academy_id
   and block_student.student_id = publication.student_id
   and block_student.start_date <= publication.record_date
   and (block_student.end_date is null or block_student.end_date >= publication.record_date)
  join public.class_schedule_blocks block
    on block.id = block_student.block_id
   and block.academy_id = publication.academy_id
   and block.effective_start <= publication.record_date
   and block.effective_end >= publication.record_date
  join public.daily_common_homework homework
    on homework.academy_id = publication.academy_id
   and homework.class_id = block.class_id
   and homework.record_date = publication.record_date
   and homework.save_state = 'final'
   and (homework.subject_id is null or homework.subject_id = block.subject_id)
   and homework.operation_group in (coalesce(block_student.operation_group, 'common'), 'common')
  where publication.academy_id = p_academy_id
    and publication.record_date = p_record_date
    and publication.status = 'published'
    and (p_student_id is null or publication.student_id = p_student_id)
    and (p_class_id is null or homework.class_id = p_class_id)
  order by
    publication.academy_id,
    publication.student_id,
    publication.record_date,
    homework.id,
    (homework.subject_id is null),
    (homework.operation_group <> coalesce(block_student.operation_group, 'common')),
    block.subject_name_snapshot
  on conflict (academy_id, student_id, record_date, daily_common_homework_id)
  do update set
    class_id = excluded.class_id,
    subject_id = excluded.subject_id,
    operation_group = excluded.operation_group,
    subject_name_snapshot = excluded.subject_name_snapshot,
    lesson_content = excluded.lesson_content,
    homework_content = excluded.homework_content,
    no_homework = excluded.no_homework,
    updated_at = now();
$$;

revoke all on function private.refresh_daily_common_homework_publication_snapshots(uuid, date, uuid, uuid) from public, anon, authenticated;
grant execute on function private.refresh_daily_common_homework_publication_snapshots(uuid, date, uuid, uuid) to service_role;

create or replace function private.capture_daily_homework_publication_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
begin
  if new.status = 'published' then
    perform private.refresh_daily_common_homework_publication_snapshots(
      new.academy_id,
      new.record_date,
      new.student_id,
      null
    );
  end if;
  return new;
end;
$$;

revoke all on function private.capture_daily_homework_publication_snapshot() from public, anon, authenticated;
grant execute on function private.capture_daily_homework_publication_snapshot() to service_role;

create trigger daily_record_publications_capture_homework_snapshot
after insert or update of status on public.daily_record_publications
for each row
when (new.status = 'published')
execute function private.capture_daily_homework_publication_snapshot();

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
  v_lesson_content text;
  v_lesson_content_present boolean;
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

    select row_data.lesson_content, coalesce(row_data.lesson_content_present, false), row_data.content, coalesce(row_data.no_homework, false), row_data.version
    into v_lesson_content, v_lesson_content_present, v_content, v_no_homework, v_expected_version
    from jsonb_to_record(v_homework_value) as row_data(
      lesson_content text,
      lesson_content_present boolean,
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
      set lesson_content = case when v_lesson_content_present then v_lesson_content else v_existing_homework.lesson_content end,
          content = v_content,
          no_homework = v_no_homework,
          save_state = p_save_mode,
          version = v_existing_homework.version + 1
      where id = v_existing_homework.id;
    else
      if v_expected_version is not null and v_expected_version <> 0 then
        raise exception 'daily common homework version conflict' using errcode = '40001';
      end if;
      insert into public.daily_common_homework (
        academy_id, class_id, subject_id, record_date, operation_group,
        lesson_content, content, no_homework, save_state, version
      ) values (
        p_academy_id, p_class_id, v_subject_id, p_record_date, v_operation_group,
        v_lesson_content, v_content, v_no_homework, p_save_mode, 1
      );
    end if;
    v_homework_saved_count := v_homework_saved_count + 1;
  end loop;

  perform private.refresh_daily_common_homework_publication_snapshots(
    p_academy_id,
    p_record_date,
    null,
    p_class_id
  );

  return v_core_result || jsonb_build_object('grouped_homework_saved_count', v_homework_saved_count);
end;
$$;

revoke all on function public.save_daily_records_with_grouped_homework_transaction(uuid, uuid, uuid, date, text, jsonb, jsonb, jsonb, uuid[], uuid[], uuid[], uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_daily_records_with_grouped_homework_transaction(uuid, uuid, uuid, date, text, jsonb, jsonb, jsonb, uuid[], uuid[], uuid[], uuid, jsonb) to service_role;

do $$
declare
  publication_scope record;
begin
  for publication_scope in
    select distinct academy_id, record_date
    from public.daily_record_publications
    where status = 'published'
  loop
    perform private.refresh_daily_common_homework_publication_snapshots(
      publication_scope.academy_id,
      publication_scope.record_date,
      null,
      null
    );
  end loop;
end;
$$;

commit;
