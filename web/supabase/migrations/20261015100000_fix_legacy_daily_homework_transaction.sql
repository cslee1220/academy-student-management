begin;

create or replace function public.save_daily_records_transaction(
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
  p_actor_profile_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_current_version integer;
  v_homework_id uuid;
  v_homework_version integer;
  v_homework_content text;
  v_homework_no_homework boolean;
  v_attendance_count integer := 0;
  v_subject_count integer := 0;
  v_homework_saved boolean := false;
  v_published_count integer := 0;
  v_student_id uuid;
begin
  if p_save_mode not in ('draft', 'final') then
    raise exception 'invalid save mode' using errcode = '22023';
  end if;
  if jsonb_typeof(p_attendance_rows) <> 'array' or jsonb_typeof(p_subject_rows) <> 'array' then
    raise exception 'record rows must be arrays' using errcode = '22023';
  end if;

  if p_homework is not null then
    select row_data.content, coalesce(row_data.no_homework, false)
    into v_homework_content, v_homework_no_homework
    from jsonb_to_record(p_homework) as row_data(content text, no_homework boolean);

    select id, version
    into v_homework_id, v_homework_version
    from public.daily_common_homework
    where academy_id = p_academy_id
      and class_id = p_class_id
      and record_date = p_record_date
      and subject_id is null
      and operation_group is null
    order by id
    limit 1
    for update;

    if v_homework_id is null then
      insert into public.daily_common_homework (
        academy_id, class_id, record_date, content, no_homework, save_state, version
      ) values (
        p_academy_id, p_class_id, p_record_date, v_homework_content,
        v_homework_no_homework, p_save_mode, 1
      );
    else
      update public.daily_common_homework
      set content = v_homework_content,
          no_homework = v_homework_no_homework,
          save_state = p_save_mode,
          version = v_homework_version + 1
      where id = v_homework_id;
    end if;
    v_homework_saved := true;
  end if;

  for v_row in
    select *
    from jsonb_to_recordset(p_attendance_rows) as item(
      student_id uuid,
      attendance_status text,
      absence_note text,
      save_state text,
      version integer,
      expected_version integer
    )
  loop
    select version into v_current_version
    from public.daily_attendance_records
    where academy_id = p_academy_id
      and block_id = p_block_id
      and student_id = v_row.student_id
      and record_date = p_record_date
    for update;

    if found and v_current_version is distinct from v_row.expected_version then
      raise exception 'daily attendance record version conflict' using errcode = '40001';
    end if;

    insert into public.daily_attendance_records (
      academy_id, block_id, student_id, record_date, attendance_status,
      absence_note, save_state, version
    ) values (
      p_academy_id, p_block_id, v_row.student_id, p_record_date,
      v_row.attendance_status, v_row.absence_note, p_save_mode, v_row.version
    )
    on conflict (academy_id, block_id, student_id, record_date) do update
      set attendance_status = excluded.attendance_status,
          absence_note = excluded.absence_note,
          save_state = excluded.save_state,
          version = excluded.version;
    v_attendance_count := v_attendance_count + 1;
  end loop;

  for v_row in
    select *
    from jsonb_to_recordset(p_subject_rows) as item(
      student_id uuid,
      subject_id uuid,
      teacher_id uuid,
      subject_name_snapshot text,
      teacher_name_snapshot text,
      homework_score smallint,
      understanding_score smallint,
      participation_score smallint,
      is_supplementary boolean,
      is_test_supplementary boolean,
      test_supplement_date date,
      is_homework_supplementary boolean,
      homework_supplement_date date,
      homework_supplement_content text,
      public_note text,
      test_definitions jsonb,
      test_results jsonb,
      save_state text,
      version integer,
      expected_version integer
    )
  loop
    select version into v_current_version
    from public.daily_subject_records
    where academy_id = p_academy_id
      and block_id = p_block_id
      and student_id = v_row.student_id
      and record_date = p_record_date
    for update;

    if found and v_current_version is distinct from v_row.expected_version then
      raise exception 'daily subject record version conflict' using errcode = '40001';
    end if;

    insert into public.daily_subject_records (
      academy_id, block_id, student_id, record_date, subject_id, teacher_id,
      subject_name_snapshot, teacher_name_snapshot, homework_score,
      understanding_score, participation_score, is_supplementary,
      is_test_supplementary, test_supplement_date, is_homework_supplementary,
      homework_supplement_date, homework_supplement_content, public_note,
      test_definitions, test_results, save_state, version
    ) values (
      p_academy_id, p_block_id, v_row.student_id, p_record_date, v_row.subject_id,
      v_row.teacher_id, v_row.subject_name_snapshot, v_row.teacher_name_snapshot,
      v_row.homework_score, v_row.understanding_score, v_row.participation_score,
      coalesce(v_row.is_supplementary, false), coalesce(v_row.is_test_supplementary, false),
      v_row.test_supplement_date, coalesce(v_row.is_homework_supplementary, false),
      v_row.homework_supplement_date, v_row.homework_supplement_content,
      v_row.public_note, coalesce(v_row.test_definitions, '[]'::jsonb),
      coalesce(v_row.test_results, '[]'::jsonb), p_save_mode, v_row.version
    )
    on conflict (academy_id, block_id, student_id, record_date) do update
      set subject_id = excluded.subject_id,
          teacher_id = excluded.teacher_id,
          subject_name_snapshot = excluded.subject_name_snapshot,
          teacher_name_snapshot = excluded.teacher_name_snapshot,
          homework_score = excluded.homework_score,
          understanding_score = excluded.understanding_score,
          participation_score = excluded.participation_score,
          is_supplementary = excluded.is_supplementary,
          is_test_supplementary = excluded.is_test_supplementary,
          test_supplement_date = excluded.test_supplement_date,
          is_homework_supplementary = excluded.is_homework_supplementary,
          homework_supplement_date = excluded.homework_supplement_date,
          homework_supplement_content = excluded.homework_supplement_content,
          public_note = excluded.public_note,
          test_definitions = excluded.test_definitions,
          test_results = excluded.test_results,
          save_state = excluded.save_state,
          version = excluded.version;
    v_subject_count := v_subject_count + 1;
  end loop;

  insert into public.daily_record_publications (
    academy_id, student_id, record_date, status, updated_by_profile_id
  )
  select p_academy_id, student_id, p_record_date, 'draft', p_actor_profile_id
  from unnest(coalesce(p_draft_student_ids, array[]::uuid[])) as students(student_id)
  on conflict (academy_id, student_id, record_date) do update
    set status = 'draft', updated_by_profile_id = excluded.updated_by_profile_id;

  if p_save_mode = 'final' then
    for v_student_id in
      select student_id
      from unnest(coalesce(p_published_student_ids, array[]::uuid[])) as candidates(student_id)
    loop
      if cardinality(coalesce(p_expected_block_ids, array[]::uuid[])) > 0
        and not exists (
          select 1
          from unnest(p_expected_block_ids) as expected(block_id)
          where not (
            exists (
              select 1
              from public.class_schedule_block_students roster
              where roster.academy_id = p_academy_id
                and roster.block_id = expected.block_id
                and roster.student_id = v_student_id
                and roster.is_active = true
                and roster.start_date <= p_record_date
                and (roster.end_date is null or roster.end_date >= p_record_date)
            )
            and exists (
              select 1
              from public.daily_subject_records subject_record
              where subject_record.academy_id = p_academy_id
                and subject_record.block_id = expected.block_id
                and subject_record.student_id = v_student_id
                and subject_record.record_date = p_record_date
                and subject_record.save_state = 'final'
            )
            and exists (
              select 1
              from public.daily_attendance_records attendance_record
              where attendance_record.academy_id = p_academy_id
                and attendance_record.block_id = expected.block_id
                and attendance_record.student_id = v_student_id
                and attendance_record.record_date = p_record_date
                and attendance_record.save_state = 'final'
            )
          )
        ) then
        insert into public.daily_record_publications (
          academy_id, student_id, record_date, status, updated_by_profile_id
        ) values (
          p_academy_id, v_student_id, p_record_date, 'published', p_actor_profile_id
        )
        on conflict (academy_id, student_id, record_date) do update
          set status = 'published', updated_by_profile_id = excluded.updated_by_profile_id;
        v_published_count := v_published_count + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'attendance_count', v_attendance_count,
    'subject_count', v_subject_count,
    'homework_saved', v_homework_saved,
    'published_count', v_published_count
  );
end;
$$;

commit;
