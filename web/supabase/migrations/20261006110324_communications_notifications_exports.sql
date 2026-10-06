create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  title text not null check (char_length(trim(title)) between 1 and 200),
  body text not null check (char_length(trim(body)) between 1 and 10000),
  audience text not null default 'all' check (audience in ('all', 'guardian', 'teacher')),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  is_pinned boolean not null default false,
  publish_at timestamptz,
  expires_at timestamptz,
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  updated_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or publish_at is null or publish_at <= expires_at)
);

create index if not exists announcements_academy_status_idx
  on public.announcements (academy_id, status, publish_at desc, created_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  recipient_type text not null check (recipient_type in ('academy_admin', 'teacher', 'guardian')),
  recipient_id uuid not null,
  notification_type text not null check (notification_type in ('announcement', 'inquiry')),
  title text not null check (char_length(trim(title)) between 1 and 200),
  body text not null check (char_length(trim(body)) between 1 and 2000),
  target_path text not null,
  related_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_idx
  on public.notifications (academy_id, recipient_type, recipient_id, read_at, created_at desc);

create table if not exists public.export_logs (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  export_no text not null unique,
  exported_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  export_type text not null check (export_type in ('admin_report_csv', 'private_record_csv')),
  filters_json jsonb not null default '{}'::jsonb,
  target_summary_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists export_logs_academy_created_idx
  on public.export_logs (academy_id, created_at desc);

drop trigger if exists announcements_set_updated_at on public.announcements;
create trigger announcements_set_updated_at
before update on public.announcements
for each row execute function private.set_updated_at();

alter table public.announcements enable row level security;
alter table public.notifications enable row level security;
alter table public.export_logs enable row level security;

revoke all on table public.announcements, public.notifications, public.export_logs from anon, authenticated;
grant select on table public.announcements to authenticated;
grant select on table public.notifications to authenticated;
grant select on table public.export_logs to authenticated;

drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin', 'teacher']::text[])
  or (
    audience in ('all', 'guardian')
    and status = 'published'
    and (publish_at is null or publish_at <= now())
    and (expires_at is null or expires_at >= now())
    and exists (
      select 1
      from public.guardians g
      where g.id in (
        select sg.guardian_id
        from public.student_guardians sg
        where sg.academy_id = announcements.academy_id
          and sg.is_active
      )
      and g.auth_user_id = (select auth.uid())
      and g.guardian_access_revoked_at is null
    )
  )
);

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
for select to authenticated
using (
  (recipient_type in ('academy_admin', 'teacher') and recipient_id = private.current_profile_id())
  or (
    recipient_type = 'guardian'
    and recipient_id in (select g.id from public.guardians g where g.auth_user_id = (select auth.uid()))
  )
);

drop policy if exists notifications_update on public.notifications;

drop policy if exists export_logs_select on public.export_logs;
create policy export_logs_select on public.export_logs
for select to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]));
