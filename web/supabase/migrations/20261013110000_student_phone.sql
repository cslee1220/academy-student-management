-- Store the student's own contact number separately from guardian contacts.
alter table public.students
  add column if not exists student_phone text;

create index if not exists students_academy_student_phone_idx
  on public.students (academy_id, student_phone);

-- Keep the status transition transaction in sync with the new student contact field.
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
      student_phone = case when p_student_patch ? 'student_phone' then p_student_patch ->> 'student_phone' else v_student.student_phone end,
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
