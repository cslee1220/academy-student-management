-- Restore guardian-link and guardian-account revocation checks after the
-- inactive-student policy migration replaced the shared helper.

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
      and s.current_status not in ('paused', 'on_hold', 'withdrawn')
      and g.auth_user_id = (select auth.uid())
  );
$$;

revoke execute on function private.guardian_can_view_student(uuid, uuid) from public;
grant execute on function private.guardian_can_view_student(uuid, uuid) to authenticated;

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
      from public.student_guardians sg
      join public.guardians g on g.id = sg.guardian_id
      join public.students s on s.id = sg.student_id
      where sg.academy_id = announcements.academy_id
        and sg.is_active
        and sg.access_revoked_at is null
        and g.id = sg.guardian_id
        and g.academy_id = announcements.academy_id
        and g.auth_user_id = (select auth.uid())
        and g.guardian_access_revoked_at is null
        and s.academy_id = announcements.academy_id
        and s.current_status not in ('paused', 'on_hold', 'withdrawn')
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
    and exists (
      select 1
      from public.guardians g
      join public.student_guardians sg on sg.guardian_id = g.id
      join public.students s on s.id = sg.student_id
      where g.id = notifications.recipient_id
        and g.academy_id = notifications.academy_id
        and g.auth_user_id = (select auth.uid())
        and g.guardian_access_revoked_at is null
        and sg.academy_id = notifications.academy_id
        and sg.is_active
        and sg.access_revoked_at is null
        and s.academy_id = notifications.academy_id
        and s.current_status not in ('paused', 'on_hold', 'withdrawn')
    )
  )
);
