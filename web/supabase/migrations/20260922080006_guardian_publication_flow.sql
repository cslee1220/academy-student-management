-- Guardian invitation, device registration, and immutable public snapshot values.
-- This migration intentionally contains no demo or personal data.

alter table public.guardians
  add column if not exists password_setup_required boolean not null default true,
  add column if not exists is_login_active boolean not null default true;

alter table public.publication_snapshots
  add column if not exists value_json jsonb not null default '{}'::jsonb;

create table public.guardian_invites (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  guardian_id uuid not null references public.guardians (id) on delete restrict,
  invite_token_hash text not null unique,
  auth_code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create table public.guardian_devices (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  guardian_id uuid not null references public.guardians (id) on delete restrict,
  device_id_hash text not null,
  registered_at timestamptz not null default now(),
  last_seen_at timestamptz,
  is_active boolean not null default true,
  unique (guardian_id, device_id_hash)
);

alter table public.guardian_invites enable row level security;
alter table public.guardian_devices enable row level security;

revoke all on table public.guardian_invites from anon, authenticated;
revoke all on table public.guardian_devices from anon, authenticated;
grant select, insert, update on table public.guardian_devices to authenticated;

create policy guardian_devices_select on public.guardian_devices
for select to authenticated
using (
  exists (
    select 1
    from public.guardians g
    where g.id = guardian_devices.guardian_id
      and g.auth_user_id = (select auth.uid())
  )
  or private.has_academy_role(academy_id, array['academy_admin']::text[])
);

create policy guardian_devices_insert on public.guardian_devices
for insert to authenticated
with check (
  exists (
    select 1
    from public.guardians g
    where g.id = guardian_devices.guardian_id
      and g.auth_user_id = (select auth.uid())
  )
  or private.has_academy_role(academy_id, array['academy_admin']::text[])
);

create policy guardian_devices_update on public.guardian_devices
for update to authenticated
using (
  exists (
    select 1
    from public.guardians g
    where g.id = guardian_devices.guardian_id
      and g.auth_user_id = (select auth.uid())
  )
  or private.has_academy_role(academy_id, array['academy_admin']::text[])
)
with check (
  exists (
    select 1
    from public.guardians g
    where g.id = guardian_devices.guardian_id
      and g.auth_user_id = (select auth.uid())
  )
  or private.has_academy_role(academy_id, array['academy_admin']::text[])
);

create policy students_guardian_select on public.students
for select to authenticated
using (private.guardian_can_view_student(academy_id, id));

create policy sessions_guardian_select on public.class_sessions
for select to authenticated
using (
  exists (
    select 1
    from public.publication_bundles pb
    where pb.session_id = class_sessions.id
      and pb.status = 'published'
      and private.guardian_can_view_student(pb.academy_id, pb.student_id)
  )
);

create index guardian_invites_academy_created_at_idx
  on public.guardian_invites (academy_id, created_at);
create index guardian_invites_guardian_expires_at_idx
  on public.guardian_invites (guardian_id, expires_at);
create index guardian_devices_academy_guardian_idx
  on public.guardian_devices (academy_id, guardian_id);
