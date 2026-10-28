-- Prevent concurrent teacher registrations from bypassing the API pre-check.
-- The lock is scoped to academy + normalized display name and is transaction
-- local, so unrelated teacher registrations remain concurrent.

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
  perform pg_advisory_xact_lock(hashtextextended(concat(p_academy_id::text, ':', lower(trim(p_display_name))), 0));

  if exists (
    select 1
    from public.teacher_accounts account
    join public.profiles profile on profile.id = account.profile_id
    where account.academy_id = p_academy_id
      and account.is_login_active
      and profile.is_login_active
      and profile.display_name = trim(p_display_name)
      and exists (
        select 1
        from public.academy_memberships membership
        where membership.academy_id = p_academy_id
          and membership.profile_id = account.profile_id
          and membership.role in ('teacher', 'supplement_teacher')
          and membership.is_active
      )
  ) then
    raise exception using errcode = '23505', message = 'duplicate teacher name';
  end if;

  insert into public.profiles (
    auth_user_id, display_name, password_setup_required, is_login_active
  ) values (
    p_auth_user_id, trim(p_display_name), true, true
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
    jsonb_build_object('login_id', p_login_id, 'display_name', trim(p_display_name)),
    'teacher account created',
    p_actor_profile_id
  );

  return jsonb_build_object('profile_id', v_profile_id, 'account_id', v_account_id);
end;
$$;
