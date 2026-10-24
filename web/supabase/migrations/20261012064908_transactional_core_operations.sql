-- Keep multi-table state transitions inside PostgreSQL transactions. These
-- functions are intentionally callable only by the server-side service role;
-- route handlers perform the user-facing authorization and input validation.

create or replace function public.transition_student_status_transaction(
  p_academy_id uuid,
  p_student_id uuid,
  p_previous_status text,
  p_next_status text,
  p_effective_date date,
  p_withdrawal_type text,
  p_reason text,
  p_expected_return_date date,
  p_student_patch jsonb,
  p_actor_profile_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_student public.students%rowtype;
  v_updated public.students%rowtype;
  v_now timestamptz := now();
  v_guardian record;
begin
  select * into v_student
  from public.students
  where id = p_student_id
    and academy_id = p_academy_id
  for update;

  if not found then
    raise exception 'student was not found' using errcode = 'P0002';
  end if;

  if v_student.current_status is distinct from p_previous_status then
    raise exception 'student status changed' using errcode = '40001';
  end if;

  if p_effective_date < v_student.registered_at then
    raise exception 'status effective date is before registration' using errcode = '22023';
  end if;

  if p_next_status = 'withdrawn' and p_withdrawal_type is null then
    raise exception 'withdrawal type is required' using errcode = '22023';
  end if;

  update public.students
  set student_no = case when p_student_patch ? 'student_no' then p_student_patch ->> 'student_no' else v_student.student_no end,
      name = case when p_student_patch ? 'name' then p_student_patch ->> 'name' else v_student.name end,
      school_name = case when p_student_patch ? 'school_name' then p_student_patch ->> 'school_name' else v_student.school_name end,
      school_level = case when p_student_patch ? 'school_level' then p_student_patch ->> 'school_level' else v_student.school_level end,
      school_id = case when p_student_patch ? 'school_id' then (p_student_patch ->> 'school_id')::uuid else v_student.school_id end,
      grade = case when p_student_patch ? 'grade' then p_student_patch ->> 'grade' else v_student.grade end,
      class_start_date = case when p_student_patch ? 'class_start_date' then (p_student_patch ->> 'class_start_date')::date else v_student.class_start_date end,
      level = case when p_student_patch ? 'level' then p_student_patch ->> 'level' else v_student.level end,
      classroom_id = case when p_student_patch ? 'classroom_id' then (p_student_patch ->> 'classroom_id')::uuid else v_student.classroom_id end,
      vehicle_id = case when p_student_patch ? 'vehicle_id' then (p_student_patch ->> 'vehicle_id')::uuid else v_student.vehicle_id end,
      guardian1_name = case when p_student_patch ? 'guardian1_name' then p_student_patch ->> 'guardian1_name' else v_student.guardian1_name end,
      phone = case when p_student_patch ? 'phone' then p_student_patch ->> 'phone' else v_student.phone end,
      phone_relationship = case when p_student_patch ? 'phone_relationship' then p_student_patch ->> 'phone_relationship' else v_student.phone_relationship end,
      guardian2_name = case when p_student_patch ? 'guardian2_name' then p_student_patch ->> 'guardian2_name' else v_student.guardian2_name end,
      phone2 = case when p_student_patch ? 'phone2' then p_student_patch ->> 'phone2' else v_student.phone2 end,
      phone2_relationship = case when p_student_patch ? 'phone2_relationship' then p_student_patch ->> 'phone2_relationship' else v_student.phone2_relationship end,
      current_status = p_next_status
  where id = p_student_id
    and academy_id = p_academy_id
  returning * into v_updated;

  insert into public.student_status_history (
    academy_id,
    student_id,
    previous_status,
    next_status,
    effective_date,
    withdrawal_type,
    reason,
    expected_return_date,
    changed_by_profile_id
  ) values (
    p_academy_id,
    p_student_id,
    p_previous_status,
    p_next_status,
    p_effective_date,
    p_withdrawal_type,
    p_reason,
    p_expected_return_date,
    p_actor_profile_id
  );

  if p_next_status = 'withdrawn' then
    update public.student_class_assignments
    set status = 'ended',
        end_date = greatest(start_date, p_effective_date)
    where academy_id = p_academy_id
      and student_id = p_student_id
      and status = 'active';

    update public.session_student_rosters roster
    set is_expected = false
    from public.class_sessions session_row
    where roster.academy_id = p_academy_id
      and roster.student_id = p_student_id
      and roster.session_id = session_row.id
      and session_row.academy_id = p_academy_id
      and session_row.session_date > p_effective_date
      and roster.is_expected = true;

    update public.student_guardians
    set access_revoked_at = coalesce(access_revoked_at, v_now)
    where academy_id = p_academy_id
      and student_id = p_student_id
      and is_active = true;

    for v_guardian in
      select distinct guardian_id
      from public.student_guardians
      where academy_id = p_academy_id
        and student_id = p_student_id
    loop
      if not exists (
        select 1
        from public.student_guardians link_row
        join public.students child on child.id = link_row.student_id
        where link_row.academy_id = p_academy_id
          and link_row.guardian_id = v_guardian.guardian_id
          and link_row.is_active = true
          and link_row.access_revoked_at is null
          and child.academy_id = p_academy_id
          and child.current_status not in ('paused', 'on_hold', 'withdrawn')
      ) then
        update public.guardians
        set guardian_access_revoked_at = coalesce(guardian_access_revoked_at, v_now)
        where academy_id = p_academy_id
          and id = v_guardian.guardian_id;
      end if;
    end loop;
  end if;

  insert into public.audit_logs (
    academy_id,
    target_table,
    target_id,
    field_key,
    old_value_json,
    new_value_json,
    reason,
    actor_profile_id
  ) values (
    p_academy_id,
    'students',
    p_student_id,
    'status',
    jsonb_build_object('current_status', p_previous_status),
    jsonb_build_object(
      'current_status', p_next_status,
      'effective_date', p_effective_date,
      'withdrawal_type', p_withdrawal_type,
      'expected_return_date', p_expected_return_date
    ),
    coalesce(p_reason, 'student status changed'),
    p_actor_profile_id
  );

  return jsonb_build_object(
    'student_id', v_updated.id,
    'previous_status', p_previous_status,
    'next_status', v_updated.current_status,
    'effective_date', p_effective_date
  );
end;
$$;

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
    insert into public.daily_common_homework (
      academy_id, class_id, record_date, content, no_homework, save_state, version
    )
    select
      p_academy_id,
      p_class_id,
      p_record_date,
      row_data.content,
      coalesce(row_data.no_homework, false),
      p_save_mode,
      1
    from jsonb_to_record(p_homework) as row_data(content text, no_homework boolean)
    on conflict (academy_id, class_id, record_date) do update
      set content = excluded.content,
          no_homework = excluded.no_homework,
          save_state = excluded.save_state,
          version = public.daily_common_homework.version + 1;
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

create or replace function public.revoke_guardian_invite_transaction(
  p_academy_id uuid,
  p_guardian_id uuid,
  p_student_id uuid,
  p_actor_profile_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_invite_id uuid;
begin
  select id into v_invite_id
  from public.guardian_invites
  where academy_id = p_academy_id
    and guardian_id = p_guardian_id
    and student_id = p_student_id
    and used_at is null
    and revoked_at is null
  order by created_at desc
  limit 1
  for update;

  if v_invite_id is null then
    raise exception 'invite was not found' using errcode = 'P0002';
  end if;

  update public.guardian_invites
  set revoked_at = now()
  where id = v_invite_id;

  insert into public.audit_logs (
    academy_id, target_table, target_id, field_key, new_value_json, reason, actor_profile_id
  ) values (
    p_academy_id,
    'guardian_invites',
    v_invite_id,
    'guardian_invite_revoked',
    jsonb_build_object('student_id', p_student_id, 'guardian_id', p_guardian_id),
    'guardian invite revoked',
    p_actor_profile_id
  );

  return v_invite_id;
end;
$$;

create or replace function public.reissue_guardian_invite_transaction(
  p_academy_id uuid,
  p_guardian_id uuid,
  p_student_id uuid,
  p_invite_token_hash text,
  p_auth_code_hash text,
  p_expires_at timestamptz,
  p_actor_profile_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_invite_id uuid;
begin
  if not exists (
    select 1 from public.guardians
    where id = p_guardian_id
      and academy_id = p_academy_id
      and auth_user_id is not null
      and is_login_active = true
  ) then
    raise exception 'guardian account is inactive' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.students
    where id = p_student_id
      and academy_id = p_academy_id
      and current_status <> 'withdrawn'
  ) then
    raise exception 'student was not found or withdrawn' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.student_guardians
    where academy_id = p_academy_id
      and guardian_id = p_guardian_id
      and student_id = p_student_id
      and is_active = true
  ) then
    raise exception 'guardian link was not found' using errcode = 'P0002';
  end if;

  update public.guardian_invites
  set revoked_at = now()
  where academy_id = p_academy_id
    and guardian_id = p_guardian_id
    and student_id = p_student_id
    and used_at is null
    and revoked_at is null;

  update public.student_guardians
  set access_revoked_at = null
  where academy_id = p_academy_id
    and guardian_id = p_guardian_id
    and student_id = p_student_id
    and is_active = true;

  update public.guardians
  set guardian_access_revoked_at = null
  where academy_id = p_academy_id
    and id = p_guardian_id;

  insert into public.guardian_invites (
    academy_id, student_id, guardian_id, invite_token_hash, auth_code_hash,
    expires_at, created_by_profile_id
  ) values (
    p_academy_id, p_student_id, p_guardian_id, p_invite_token_hash,
    p_auth_code_hash, p_expires_at, p_actor_profile_id
  ) returning id into v_invite_id;

  insert into public.audit_logs (
    academy_id, target_table, target_id, field_key, new_value_json, reason, actor_profile_id
  ) values (
    p_academy_id,
    'guardian_invites',
    v_invite_id,
    'guardian_invite_reissued',
    jsonb_build_object('student_id', p_student_id, 'guardian_id', p_guardian_id),
    'guardian invite reissued',
    p_actor_profile_id
  );

  return v_invite_id;
end;
$$;

create or replace function public.create_teacher_account_records_transaction(
  p_academy_id uuid,
  p_auth_user_id uuid,
  p_display_name text,
  p_login_id text,
  p_activation_code_hash text,
  p_activation_expires_at timestamptz,
  p_actor_profile_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid;
  v_account_id uuid;
begin
  insert into public.profiles (
    auth_user_id, display_name, password_setup_required, is_login_active
  ) values (
    p_auth_user_id, p_display_name, true, true
  ) returning id into v_profile_id;

  insert into public.teacher_accounts (
    academy_id, profile_id, auth_user_id, login_id, activation_code_hash,
    activation_expires_at, password_setup_required, is_login_active
  ) values (
    p_academy_id, v_profile_id, p_auth_user_id, p_login_id, p_activation_code_hash,
    p_activation_expires_at, true, true
  ) returning id into v_account_id;

  insert into public.academy_memberships (
    academy_id, profile_id, role, is_active
  ) values (
    p_academy_id, v_profile_id, 'teacher', true
  );

  insert into public.audit_logs (
    academy_id, target_table, target_id, field_key, new_value_json, reason, actor_profile_id
  ) values (
    p_academy_id,
    'teacher_accounts',
    v_account_id,
    'teacher_account_created',
    jsonb_build_object('login_id', p_login_id, 'display_name', p_display_name),
    'teacher account created',
    p_actor_profile_id
  );

  return jsonb_build_object('profile_id', v_profile_id, 'account_id', v_account_id);
end;
$$;

create or replace function public.activate_teacher_account_transaction(
  p_account_id uuid,
  p_activated_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_account public.teacher_accounts%rowtype;
begin
  select * into v_account
  from public.teacher_accounts
  where id = p_account_id
  for update;
  if not found then
    raise exception 'teacher account was not found' using errcode = 'P0002';
  end if;

  update public.profiles
  set password_setup_required = false, is_login_active = true
  where id = v_account.profile_id;

  update public.teacher_accounts
  set activation_code_hash = null,
      activation_expires_at = null,
      password_setup_required = false,
      updated_at = p_activated_at
  where id = v_account.id;

  update public.academy_memberships
  set activated_at = p_activated_at, is_active = true
  where academy_id = v_account.academy_id
    and profile_id = v_account.profile_id
    and role = 'teacher';

  insert into public.audit_logs (
    academy_id, target_table, target_id, field_key, new_value_json, reason, actor_profile_id
  ) values (
    v_account.academy_id,
    'teacher_accounts',
    v_account.id,
    'teacher_account_activated',
    jsonb_build_object('activated_at', p_activated_at),
    'teacher account activated',
    v_account.profile_id
  );

  return jsonb_build_object('account_id', v_account.id, 'profile_id', v_account.profile_id);
end;
$$;

create or replace function public.deactivate_teacher_account_transaction(
  p_academy_id uuid,
  p_account_id uuid,
  p_actor_profile_id uuid,
  p_deactivated_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_account public.teacher_accounts%rowtype;
  v_profile public.profiles%rowtype;
begin
  select * into v_account
  from public.teacher_accounts
  where id = p_account_id
    and academy_id = p_academy_id
  for update;
  if not found then
    raise exception 'teacher account was not found' using errcode = 'P0002';
  end if;

  select * into v_profile from public.profiles where id = v_account.profile_id for update;

  update public.teacher_accounts
  set is_login_active = false, updated_at = p_deactivated_at
  where id = v_account.id;
  update public.profiles set is_login_active = false where id = v_account.profile_id;
  update public.academy_memberships
  set is_active = false, deactivated_at = p_deactivated_at
  where academy_id = p_academy_id
    and profile_id = v_account.profile_id
    and role in ('teacher', 'supplement_teacher');

  insert into public.audit_logs (
    academy_id, target_table, target_id, field_key,
    old_value_json, new_value_json, reason, actor_profile_id
  ) values (
    p_academy_id,
    'teacher_accounts',
    v_account.id,
    'teacher_account_deactivated',
    jsonb_build_object(
      'login_id', v_account.login_id,
      'display_name', v_profile.display_name,
      'account_is_login_active', v_account.is_login_active,
      'profile_is_login_active', v_profile.is_login_active
    ),
    jsonb_build_object('is_login_active', false, 'deactivated_at', p_deactivated_at),
    'teacher account deactivated',
    p_actor_profile_id
  );

  return jsonb_build_object('account_id', v_account.id, 'profile_id', v_account.profile_id);
end;
$$;

revoke all on function public.transition_student_status_transaction(uuid, uuid, text, text, date, text, text, date, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.save_daily_records_transaction(uuid, uuid, uuid, date, text, jsonb, jsonb, jsonb, uuid[], uuid[], uuid[], uuid) from public, anon, authenticated;
revoke all on function public.revoke_guardian_invite_transaction(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.reissue_guardian_invite_transaction(uuid, uuid, uuid, text, text, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.create_teacher_account_records_transaction(uuid, uuid, text, text, text, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.activate_teacher_account_transaction(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.deactivate_teacher_account_transaction(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;

grant execute on function public.transition_student_status_transaction(uuid, uuid, text, text, date, text, text, date, jsonb, uuid) to service_role;
grant execute on function public.save_daily_records_transaction(uuid, uuid, uuid, date, text, jsonb, jsonb, jsonb, uuid[], uuid[], uuid[], uuid) to service_role;
grant execute on function public.revoke_guardian_invite_transaction(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.reissue_guardian_invite_transaction(uuid, uuid, uuid, text, text, timestamptz, uuid) to service_role;
grant execute on function public.create_teacher_account_records_transaction(uuid, uuid, text, text, text, timestamptz, uuid) to service_role;
grant execute on function public.activate_teacher_account_transaction(uuid, timestamptz) to service_role;
grant execute on function public.deactivate_teacher_account_transaction(uuid, uuid, uuid, timestamptz) to service_role;
