-- Passwordless guardian access and withdrawal-based access revocation.

alter table public.student_guardians
  add column if not exists access_revoked_at timestamptz;

alter table public.guardians
  add column if not exists guardian_access_revoked_at timestamptz;

with ranked_active_devices as (
  select
    id,
    row_number() over (
      partition by guardian_id
      order by last_seen_at desc nulls last, registered_at desc, id desc
    ) as device_rank
  from public.guardian_devices
  where is_active
)
update public.guardian_devices devices
set is_active = false
from ranked_active_devices ranked
where devices.id = ranked.id
  and ranked.device_rank > 1;

create unique index if not exists guardian_devices_one_active_idx
  on public.guardian_devices (guardian_id)
  where is_active;

create or replace function private.guardian_can_view_student(p_academy_id uuid, p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.student_guardians sg
    join public.guardians g on g.id = sg.guardian_id
    join public.students s on s.id = sg.student_id
    where sg.academy_id = p_academy_id
      and sg.student_id = p_student_id
      and sg.is_active
      and sg.access_revoked_at is null
      and g.academy_id = p_academy_id
      and g.guardian_access_revoked_at is null
      and s.academy_id = p_academy_id
      and s.current_status <> 'withdrawn'
      and g.auth_user_id = (select auth.uid())
  )
$$;

grant execute on function private.guardian_can_view_student(uuid, uuid) to authenticated;
