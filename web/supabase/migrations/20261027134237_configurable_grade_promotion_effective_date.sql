-- Keep the existing default of January 1 while allowing the academy to choose
-- another real calendar month/day. Existing promotion batches keep their own
-- grade_promotion_batches.effective_date snapshot.
alter table public.academy_grade_promotion_settings
  drop constraint if exists academy_grade_promotion_settings_check;
alter table public.academy_grade_promotion_settings
  drop constraint if exists academy_grade_promotion_settings_effective_date_check;

alter table public.academy_grade_promotion_settings
  add constraint academy_grade_promotion_settings_effective_date_check
  check (
    effective_month between 1 and 12
    and effective_day between 1 and 31
    and not (effective_month = 2 and effective_day > 28)
    and not (effective_month in (4, 6, 9, 11) and effective_day = 31)
  );

create or replace function public.save_grade_promotion_settings_transaction(
  p_academy_id uuid,
  p_automatic_enabled boolean,
  p_effective_month smallint,
  p_effective_day smallint,
  p_enabled_from_date date,
  p_updated_by_profile_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_old_value jsonb;
  v_new_value jsonb;
begin
  select to_jsonb(settings)
    into v_old_value
  from public.academy_grade_promotion_settings settings
  where settings.academy_id = p_academy_id
  for update;

  insert into public.academy_grade_promotion_settings (
    academy_id,
    automatic_enabled,
    effective_month,
    effective_day,
    enabled_from_date,
    updated_by_profile_id
  ) values (
    p_academy_id,
    p_automatic_enabled,
    p_effective_month,
    p_effective_day,
    p_enabled_from_date,
    p_updated_by_profile_id
  )
  on conflict (academy_id) do update set
    automatic_enabled = excluded.automatic_enabled,
    effective_month = excluded.effective_month,
    effective_day = excluded.effective_day,
    enabled_from_date = excluded.enabled_from_date,
    updated_by_profile_id = excluded.updated_by_profile_id;

  select to_jsonb(settings)
    into v_new_value
  from public.academy_grade_promotion_settings settings
  where settings.academy_id = p_academy_id;

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
    'grade_promotion_settings',
    p_academy_id,
    'promotion_settings',
    v_old_value,
    v_new_value,
    '운영자가 학년 자동 승급 기준일 설정을 변경했습니다.',
    p_updated_by_profile_id
  );

  return v_new_value;
end;
$$;
