-- Extend the existing academy-scoped assessment options with managed assessment names.
-- Existing assessment records keep their text name snapshots and revision history.

alter table public.assessment_options
  drop constraint if exists assessment_options_option_kind_check;

alter table public.assessment_options
  add constraint assessment_options_option_kind_check
  check (option_kind in ('type', 'subject', 'name'));

create or replace function public.save_assessment_option_transaction(
  p_academy_id uuid,
  p_actor_profile_id uuid,
  p_option_id uuid,
  p_option_kind text,
  p_name text,
  p_is_active boolean,
  p_sort_order integer
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_current public.assessment_options%rowtype;
  v_saved public.assessment_options%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not exists (
    select 1
    from public.academy_memberships membership
    where membership.academy_id = p_academy_id
      and membership.profile_id = p_actor_profile_id
      and membership.role = 'academy_admin'
      and membership.is_active
  ) then
    raise exception 'assessment option actor is not an active academy admin' using errcode = '42501';
  end if;

  if p_option_kind not in ('type', 'subject', 'name') or char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'invalid assessment option' using errcode = '22023';
  end if;
  if coalesce(p_sort_order, 0) < 0 then
    raise exception 'invalid assessment option order' using errcode = '22023';
  end if;

  if p_option_id is null then
    insert into public.assessment_options (
      academy_id, option_kind, name, is_active, sort_order, created_by_profile_id, updated_by_profile_id
    ) values (
      p_academy_id, p_option_kind, v_name, coalesce(p_is_active, true), coalesce(p_sort_order, 0), p_actor_profile_id, p_actor_profile_id
    ) returning * into v_saved;

    insert into public.audit_logs (
      academy_id, target_table, target_id, field_key, old_value_json, new_value_json, reason, actor_profile_id
    ) values (
      p_academy_id, 'assessment_options', v_saved.id, 'create', null, to_jsonb(v_saved), 'assessment option created', p_actor_profile_id
    );
  else
    select * into v_current
    from public.assessment_options
    where id = p_option_id
      and academy_id = p_academy_id
    for update;
    if not found then
      raise exception 'assessment option not found' using errcode = 'P0002';
    end if;
    if v_current.option_kind <> p_option_kind then
      raise exception 'assessment option kind cannot change' using errcode = '22023';
    end if;

    update public.assessment_options
    set name = v_name,
        is_active = coalesce(p_is_active, v_current.is_active),
        sort_order = coalesce(p_sort_order, v_current.sort_order),
        updated_by_profile_id = p_actor_profile_id
    where id = p_option_id
    returning * into v_saved;

    insert into public.audit_logs (
      academy_id, target_table, target_id, field_key, old_value_json, new_value_json, reason, actor_profile_id
    ) values (
      p_academy_id, 'assessment_options', v_saved.id, 'update', to_jsonb(v_current), to_jsonb(v_saved), 'assessment option updated', p_actor_profile_id
    );
  end if;

  return to_jsonb(v_saved);
end;
$$;

insert into public.assessment_options (academy_id, option_kind, name, sort_order)
select source.academy_id, 'name', source.assessment_name, row_number() over (partition by source.academy_id order by source.assessment_name) - 1
from (
  select distinct academy_id, btrim(assessment_name) as assessment_name
  from public.student_assessment_records
  where char_length(btrim(assessment_name)) between 1 and 120
) source
where not exists (
  select 1
  from public.assessment_options existing
  where existing.academy_id = source.academy_id
    and existing.option_kind = 'name'
    and lower(btrim(existing.name)) = lower(source.assessment_name)
);
