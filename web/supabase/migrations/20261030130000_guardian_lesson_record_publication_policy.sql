begin;

-- The policy is academy-scoped and is separate from the teacher form's
-- enabled/disabled flags.  Keys are stable ids, never display labels.
alter table public.academy_lesson_record_settings
  add column if not exists publication_policy jsonb not null default
    '{"version":1,"publicKeys":["common_homework","common_lesson_content","student_memo","metric:00000000-0000-4000-8000-000000000001","metric:00000000-0000-4000-8000-000000000002","metric:00000000-0000-4000-8000-000000000003","supplement:00000000-0000-4000-8000-000000000011","supplement:00000000-0000-4000-8000-000000000012"]}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.academy_lesson_record_settings'::regclass
      and conname = 'academy_lesson_record_settings_publication_policy_object_check'
  ) then
    alter table public.academy_lesson_record_settings
      add constraint academy_lesson_record_settings_publication_policy_object_check
      check (jsonb_typeof(publication_policy) = 'object');
  end if;
end;
$$;

-- Existing forms were already guardian-visible.  Keep that compatibility for
-- existing metrics, supplements, and test definitions.  Future ids are not
-- added here and therefore start private until an academy admin opts in.
update public.academy_lesson_record_settings settings
set publication_policy = jsonb_build_object(
  'version', 1,
  'publicKeys', coalesce((
    select jsonb_agg(key order by key)
    from (
      select 'common_lesson_content'::text as key
      union select 'common_homework'
      union select 'student_memo'
      union
      select 'metric:' || (item ->> 'id')
      from jsonb_array_elements(coalesce(settings.metrics, '[]'::jsonb)) item
      where nullif(trim(item ->> 'id'), '') is not null
      union
      select 'supplement:' || (item ->> 'id')
      from jsonb_array_elements(coalesce(settings.supplement_types, '[]'::jsonb)) item
      where nullif(trim(item ->> 'id'), '') is not null
      union
      select 'test:' || definition.id::text
      from public.test_definitions definition
      where definition.academy_id = settings.academy_id
      union
      select 'test:' || (definition ->> 'id')
      from public.daily_subject_records record_row
      cross join lateral jsonb_array_elements(coalesce(record_row.test_definitions, '[]'::jsonb)) definition
      where record_row.academy_id = settings.academy_id
        and jsonb_typeof(record_row.test_definitions) = 'array'
        and nullif(trim(definition ->> 'id'), '') is not null
    ) keys
  ), '[]'::jsonb)
)
where settings.publication_policy is not null;

alter table public.daily_record_publications
  add column if not exists publication_policy_version integer,
  add column if not exists publication_policy_keys jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.daily_record_publications'::regclass
      and conname = 'daily_record_publications_policy_keys_array_check'
  ) then
    alter table public.daily_record_publications
      add constraint daily_record_publications_policy_keys_array_check
      check (publication_policy_keys is null or jsonb_typeof(publication_policy_keys) = 'array');
  end if;
end;
$$;

create or replace function private.active_lesson_record_publication_keys(p_academy_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = public, private, pg_temp
as $$
  select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
  from (
    select key
    from public.academy_lesson_record_settings settings
    cross join lateral jsonb_array_elements_text(settings.publication_policy -> 'publicKeys') key
    where settings.academy_id = p_academy_id
      and (
        (key in ('common_lesson_content', 'common_homework') and settings.common_record_enabled)
        or (key = 'student_memo' and settings.student_memo_enabled)
        or (
          key like 'metric:%'
          and exists (
            select 1
            from jsonb_array_elements(settings.metrics) item
            where item ->> 'id' = substring(key from 8)
              and coalesce((item ->> 'isActive')::boolean, false)
          )
        )
        or (
          key like 'supplement:%'
          and exists (
            select 1
            from jsonb_array_elements(settings.supplement_types) item
            where item ->> 'id' = substring(key from 11)
              and coalesce((item ->> 'isActive')::boolean, false)
          )
        )
        or (key like 'test:%' and settings.tests_enabled)
      )
  ) allowed;
$$;

revoke all on function private.active_lesson_record_publication_keys(uuid) from public, anon, authenticated;
grant execute on function private.active_lesson_record_publication_keys(uuid) to service_role;

create or replace function private.capture_daily_lesson_record_publication_policy()
returns trigger
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  v_policy jsonb;
begin
  if new.status = 'published'
    and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    v_policy := private.active_lesson_record_publication_keys(new.academy_id);
    new.publication_policy_keys := v_policy;
    select coalesce((settings.publication_policy ->> 'version')::integer, 1)
    into new.publication_policy_version
    from public.academy_lesson_record_settings settings
    where settings.academy_id = new.academy_id;
    new.publication_policy_version := coalesce(new.publication_policy_version, 1);
  end if;
  return new;
end;
$$;

revoke all on function private.capture_daily_lesson_record_publication_policy() from public, anon, authenticated;
grant execute on function private.capture_daily_lesson_record_publication_policy() to service_role;

drop trigger if exists daily_record_publications_capture_lesson_record_policy on public.daily_record_publications;
create trigger daily_record_publications_capture_lesson_record_policy
before insert or update of status on public.daily_record_publications
for each row execute function private.capture_daily_lesson_record_publication_policy();

-- New overload keeps older server-side callers compatible while making the
-- policy update, history row, and audit row one atomic operation for the admin
-- settings API.
create or replace function public.save_academy_lesson_record_settings_transaction(
  p_academy_id uuid,
  p_expected_version integer,
  p_tests_enabled boolean,
  p_student_memo_enabled boolean,
  p_common_record_enabled boolean,
  p_metrics jsonb,
  p_supplement_types jsonb,
  p_publication_policy jsonb,
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
    or jsonb_typeof(coalesce(p_supplement_types, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_publication_policy, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_publication_policy -> 'publicKeys', '[]'::jsonb)) <> 'array' then
    raise exception 'lesson record settings value has an invalid shape' using errcode = '22023';
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
      publication_policy = coalesce(p_publication_policy, v_current.publication_policy),
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

revoke all on function public.save_academy_lesson_record_settings_transaction(uuid, integer, boolean, boolean, boolean, jsonb, jsonb, jsonb, uuid, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.save_academy_lesson_record_settings_transaction(uuid, integer, boolean, boolean, boolean, jsonb, jsonb, jsonb, uuid, jsonb, jsonb, text) to service_role;

commit;
