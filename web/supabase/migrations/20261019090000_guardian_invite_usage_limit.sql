-- Guardian invite policy: 60-day validity, five successful uses, and
-- cancellation of any still-usable invite when a replacement is issued.

alter table public.guardian_invites
  add column if not exists use_count integer not null default 0;

-- Invites consumed under the previous one-time policy remain exhausted after
-- the policy change. New and partially used invites keep used_at null until
-- the fifth successful activation.
update public.guardian_invites
set use_count = 5
where used_at is not null
  and use_count < 5;

-- Extend currently usable links to the new 60-day lifetime without
-- reactivating links that were already expired or revoked.
update public.guardian_invites
set expires_at = created_at + interval '60 days'
where used_at is null
  and revoked_at is null
  and expires_at > now()
  and expires_at < created_at + interval '60 days';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'guardian_invites_use_count_check'
      and conrelid = 'public.guardian_invites'::regclass
  ) then
    alter table public.guardian_invites
      add constraint guardian_invites_use_count_check check (use_count between 0 and 5);
  end if;
end
$$;

create index if not exists guardian_invites_active_link_idx
  on public.guardian_invites (academy_id, guardian_id, student_id, created_at desc)
  where used_at is null and revoked_at is null;

-- Keep the usage increment and the fifth-use exhaustion decision under one
-- row lock so concurrent activation requests cannot exceed five uses.
create or replace function public.consume_guardian_invite_use(p_invite_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_use_count integer;
begin
  select use_count
    into v_use_count
  from public.guardian_invites
  where id = p_invite_id
    and used_at is null
    and revoked_at is null
    and expires_at > now()
  for update;

  if not found then
    if exists (
      select 1
      from public.guardian_invites
      where id = p_invite_id
        and (used_at is not null or use_count >= 5)
    ) then
      raise exception 'guardian invite use limit reached' using errcode = 'P0003';
    end if;
    raise exception 'guardian invite is unavailable' using errcode = 'P0002';
  end if;

  update public.guardian_invites
  set use_count = v_use_count + 1,
      used_at = case when v_use_count + 1 >= 5 then now() else null end,
      attempt_count = 0,
      last_attempt_at = null,
      locked_until = null
  where id = p_invite_id;

  return v_use_count + 1;
end;
$$;

revoke all on function public.consume_guardian_invite_use(uuid) from public, anon, authenticated;
grant execute on function public.consume_guardian_invite_use(uuid) to service_role;
