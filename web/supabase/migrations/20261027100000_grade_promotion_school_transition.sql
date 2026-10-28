-- Store school-transition snapshots and apply grade promotions atomically.
-- This migration is local-only for the current task and must not be applied remotely without approval.

alter table public.grade_promotion_items
  add column if not exists old_school_id uuid references public.schools (id) on delete restrict,
  add column if not exists old_school_name text,
  add column if not exists new_school_level text,
  add column if not exists new_school_id uuid references public.schools (id) on delete restrict,
  add column if not exists new_school_name text;

alter table public.grade_promotion_items
  add constraint grade_promotion_items_new_school_level_check
  check (new_school_level is null or new_school_level in ('elementary', 'middle', 'high'));

create index if not exists grade_promotion_items_new_school_idx
  on public.grade_promotion_items (academy_id, new_school_id);

create or replace function public.apply_grade_promotion_transaction(
  p_academy_id uuid,
  p_batch_id uuid,
  p_actor_profile_id uuid,
  p_today date
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_batch public.grade_promotion_batches%rowtype;
  v_item record;
  v_student public.students%rowtype;
  v_school public.schools%rowtype;
  v_changes jsonb := '[]'::jsonb;
  v_applied_count integer := 0;
begin
  select * into v_batch
  from public.grade_promotion_batches
  where id = p_batch_id
    and academy_id = p_academy_id
  for update;

  if not found then
    raise exception '학년 승급 배치를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if v_batch.status <> 'approved' then
    raise exception '승인된 학년 승급 배지만 적용할 수 있습니다.' using errcode = 'P0001';
  end if;
  if v_batch.effective_date > p_today then
    raise exception '승급 적용일이 아직 도래하지 않았습니다.' using errcode = '22023';
  end if;

  for v_item in
    select *
    from public.grade_promotion_items
    where academy_id = p_academy_id
      and batch_id = p_batch_id
      and status = 'pending'
    order by student_id
    for update
  loop
    if v_item.action not in ('promote', 'manual_school_level') or v_item.new_grade is null then
      continue;
    end if;

    select * into v_student
    from public.students
    where id = v_item.student_id
      and academy_id = p_academy_id
    for update;

    if not found then
      raise exception '승급 대상 학생을 찾을 수 없습니다.' using errcode = 'P0002';
    end if;
    if v_student.grade is distinct from v_item.old_grade then
      raise exception '미리보기 후 학생 학년이 변경되었습니다.' using errcode = '40001';
    end if;

    if v_item.action = 'manual_school_level' then
      if v_item.new_school_id is null or v_item.new_school_level is null then
        raise exception '진학 학교를 선택하지 않은 학생이 있어 학년 승급을 적용할 수 없습니다.' using errcode = '22023';
      end if;
      if v_item.old_school_level is not null and v_student.school_level is distinct from v_item.old_school_level then
        raise exception '미리보기 후 학생 학교급이 변경되었습니다.' using errcode = '40001';
      end if;
      if v_item.old_school_id is not null and v_student.school_id is distinct from v_item.old_school_id then
        raise exception '미리보기 후 학생 학교가 변경되었습니다.' using errcode = '40001';
      end if;

      select * into v_school
      from public.schools
      where id = v_item.new_school_id
        and academy_id = p_academy_id
      for share;

      if not found or not v_school.is_active then
        raise exception '진학 학교가 없거나 비활성 상태입니다.' using errcode = 'P0002';
      end if;
      if v_school.school_level is distinct from v_item.new_school_level then
        raise exception '선택한 진학 학교의 학교급이 승급 목표와 일치하지 않습니다.' using errcode = '23514';
      end if;

      update public.students
      set grade = v_item.new_grade,
          school_level = v_school.school_level,
          school_id = v_school.id,
          school_name = v_school.name
      where id = v_student.id
        and academy_id = p_academy_id;
    else
      update public.students
      set grade = v_item.new_grade
      where id = v_student.id
        and academy_id = p_academy_id;
    end if;

    update public.grade_promotion_items
    set status = 'applied',
        applied_at = now()
    where id = v_item.id
      and academy_id = p_academy_id;

    v_applied_count := v_applied_count + 1;
    v_changes := v_changes || jsonb_build_array(jsonb_build_object(
      'student_id', v_student.id,
      'before', jsonb_build_object(
        'school_level', v_student.school_level,
        'school_id', v_student.school_id,
        'school_name', v_student.school_name,
        'grade', v_student.grade
      ),
      'after', jsonb_build_object(
        'school_level', case when v_item.action = 'manual_school_level' then v_school.school_level else v_student.school_level end,
        'school_id', case when v_item.action = 'manual_school_level' then v_school.id else v_student.school_id end,
        'school_name', case when v_item.action = 'manual_school_level' then v_school.name else v_student.school_name end,
        'grade', v_item.new_grade
      )
    ));
  end loop;

  update public.grade_promotion_batches
  set status = 'applied',
      applied_by_profile_id = p_actor_profile_id,
      applied_at = now()
  where id = p_batch_id
    and academy_id = p_academy_id
    and status = 'approved';

  insert into public.audit_logs (
    academy_id, target_table, target_id, field_key,
    old_value_json, new_value_json, reason, actor_profile_id
  ) values (
    p_academy_id,
    'grade_promotion_batches',
    p_batch_id,
    'applied',
    jsonb_build_object('status', 'approved'),
    jsonb_build_object('status', 'applied', 'changed_count', v_applied_count, 'changes', v_changes),
    '운영자가 학년 승급 배치를 적용했습니다.',
    p_actor_profile_id
  );

  return jsonb_build_object('applied_count', v_applied_count, 'changes', v_changes);
end;
$$;

create or replace function public.revert_grade_promotion_transaction(
  p_academy_id uuid,
  p_batch_id uuid,
  p_actor_profile_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_batch public.grade_promotion_batches%rowtype;
  v_item record;
  v_student public.students%rowtype;
  v_changes jsonb := '[]'::jsonb;
  v_reverted_count integer := 0;
begin
  select * into v_batch
  from public.grade_promotion_batches
  where id = p_batch_id
    and academy_id = p_academy_id
  for update;

  if not found then
    raise exception '학년 승급 배치를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if v_batch.status not in ('preview', 'approved', 'applied') then
    raise exception '되돌릴 수 있는 학년 승급 배치가 아닙니다.' using errcode = 'P0001';
  end if;

  for v_item in
    select *
    from public.grade_promotion_items
    where academy_id = p_academy_id
      and batch_id = p_batch_id
      and status = 'applied'
    order by student_id
    for update
  loop
    select * into v_student
    from public.students
    where id = v_item.student_id
      and academy_id = p_academy_id
    for update;

    if not found or v_student.grade is distinct from v_item.new_grade then
      raise exception '승급 적용 후 학생 정보가 변경되어 되돌릴 수 없습니다.' using errcode = '40001';
    end if;
    if v_item.action = 'manual_school_level' and v_item.new_school_id is not null and v_student.school_id is distinct from v_item.new_school_id then
      raise exception '승급 적용 후 학생 학교가 변경되어 되돌릴 수 없습니다.' using errcode = '40001';
    end if;

    if v_item.action = 'manual_school_level' then
      update public.students
      set grade = v_item.old_grade,
          school_level = v_item.old_school_level,
          school_id = v_item.old_school_id,
          school_name = v_item.old_school_name
      where id = v_student.id
        and academy_id = p_academy_id;
    else
      update public.students
      set grade = v_item.old_grade
      where id = v_student.id
        and academy_id = p_academy_id;
    end if;

    update public.grade_promotion_items
    set status = 'reverted',
        reverted_at = now()
    where id = v_item.id
      and academy_id = p_academy_id;

    v_reverted_count := v_reverted_count + 1;
    v_changes := v_changes || jsonb_build_array(jsonb_build_object(
      'student_id', v_student.id,
      'before', jsonb_build_object(
        'school_level', v_student.school_level,
        'school_id', v_student.school_id,
        'school_name', v_student.school_name,
        'grade', v_student.grade
      ),
      'after', jsonb_build_object(
        'school_level', v_item.old_school_level,
        'school_id', v_item.old_school_id,
        'school_name', v_item.old_school_name,
        'grade', v_item.old_grade
      )
    ));
  end loop;

  update public.grade_promotion_batches
  set status = 'reverted',
      reverted_by_profile_id = p_actor_profile_id,
      reverted_at = now()
  where id = p_batch_id
    and academy_id = p_academy_id
    and status in ('preview', 'approved', 'applied');

  insert into public.audit_logs (
    academy_id, target_table, target_id, field_key,
    old_value_json, new_value_json, reason, actor_profile_id
  ) values (
    p_academy_id,
    'grade_promotion_batches',
    p_batch_id,
    'reverted',
    jsonb_build_object('status', v_batch.status),
    jsonb_build_object('status', 'reverted', 'reverted_count', v_reverted_count, 'changes', v_changes),
    '운영자가 학년 승급 배치를 되돌렸습니다.',
    p_actor_profile_id
  );

  return jsonb_build_object('reverted_count', v_reverted_count, 'changes', v_changes);
end;
$$;

revoke all on function public.apply_grade_promotion_transaction(uuid, uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.revert_grade_promotion_transaction(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.apply_grade_promotion_transaction(uuid, uuid, uuid, date) to service_role;
grant execute on function public.revert_grade_promotion_transaction(uuid, uuid, uuid) to service_role;
