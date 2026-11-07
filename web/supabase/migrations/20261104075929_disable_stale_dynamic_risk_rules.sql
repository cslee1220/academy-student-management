create or replace function private.disable_stale_dynamic_risk_rules()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_rule record;
  v_actor_profile_id uuid;
begin
  if new.academy_id is distinct from old.academy_id then
    return new;
  end if;

  v_actor_profile_id := coalesce(new.updated_by_profile_id, old.updated_by_profile_id);

  for v_rule in
    with deactivated_sources as (
      select 'metric:' || (old_item.value ->> 'id') as item_key
      from jsonb_array_elements(case when jsonb_typeof(old.metrics) = 'array' then old.metrics else '[]'::jsonb end) as old_item(value)
      where old_item.value -> 'isActive' = 'true'::jsonb
        and not exists (
          select 1
          from jsonb_array_elements(case when jsonb_typeof(new.metrics) = 'array' then new.metrics else '[]'::jsonb end) as new_item(value)
          where new_item.value ->> 'id' = old_item.value ->> 'id'
            and new_item.value -> 'isActive' = 'true'::jsonb
        )
      union
      select 'supplement:' || (old_item.value ->> 'id') as item_key
      from jsonb_array_elements(case when jsonb_typeof(old.supplement_types) = 'array' then old.supplement_types else '[]'::jsonb end) as old_item(value)
      where old_item.value -> 'isActive' = 'true'::jsonb
        and not exists (
          select 1
          from jsonb_array_elements(case when jsonb_typeof(new.supplement_types) = 'array' then new.supplement_types else '[]'::jsonb end) as new_item(value)
          where new_item.value ->> 'id' = old_item.value ->> 'id'
            and new_item.value -> 'isActive' = 'true'::jsonb
        )
    ),
    has_deactivated_supplement as (
      select exists (
        select 1
        from jsonb_array_elements(case when jsonb_typeof(old.supplement_types) = 'array' then old.supplement_types else '[]'::jsonb end) as old_item(value)
        where old_item.value -> 'isActive' = 'true'::jsonb
          and not exists (
            select 1
            from jsonb_array_elements(case when jsonb_typeof(new.supplement_types) = 'array' then new.supplement_types else '[]'::jsonb end) as new_item(value)
            where new_item.value ->> 'id' = old_item.value ->> 'id'
              and new_item.value -> 'isActive' = 'true'::jsonb
          )
      ) as value
    )
    update public.risk_rule_settings as current_rule
    set is_enabled = false
    where current_rule.academy_id = new.academy_id
      and current_rule.is_enabled = true
      and (
        current_rule.item_key in (select item_key from deactivated_sources)
        or (current_rule.item_key = 'supplement:all' and (select value from has_deactivated_supplement))
      )
    returning current_rule.id, current_rule.item_key
  loop
    if v_actor_profile_id is null then
      raise exception 'A profile is required to audit automatic risk-rule deactivation.' using errcode = '23502';
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
      new.academy_id,
      'risk_rule_settings',
      v_rule.id,
      'is_enabled',
      'true'::jsonb,
      'false'::jsonb,
      'Automatically disabled because its linked metric or supplement type was deactivated. Review and re-enable the criterion manually if needed.',
      v_actor_profile_id
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists academy_lesson_record_settings_disable_stale_risk_rules on public.academy_lesson_record_settings;
create trigger academy_lesson_record_settings_disable_stale_risk_rules
after update of metrics, supplement_types on public.academy_lesson_record_settings
for each row execute function private.disable_stale_dynamic_risk_rules();
