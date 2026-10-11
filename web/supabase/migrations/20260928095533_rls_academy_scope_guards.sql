-- Tighten tenant boundaries for teacher and guardian RLS checks.
-- This migration intentionally contains no demo or personal data.

create or replace function private.teacher_has_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.class_sessions cs
    where cs.id = p_session_id
      and private.has_academy_role(cs.academy_id, array['teacher']::text[])
      and (
        cs.lead_teacher_id = private.current_profile_id()
        or exists (
          select 1
          from public.session_subject_assignments ssa
          where ssa.academy_id = cs.academy_id
            and ssa.session_id = cs.id
            and ssa.teacher_id = private.current_profile_id()
        )
      )
  )
$$;

create or replace function private.teacher_is_lead_for_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.class_sessions cs
    where cs.id = p_session_id
      and cs.lead_teacher_id = private.current_profile_id()
      and private.has_academy_role(cs.academy_id, array['teacher']::text[])
  )
$$;

create or replace function private.teacher_has_subject(p_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.session_subject_assignments ssa
    where ssa.subject_id = p_subject_id
      and ssa.teacher_id = private.current_profile_id()
      and private.has_academy_role(ssa.academy_id, array['teacher']::text[])
  )
$$;

create or replace function private.teacher_can_access_student(p_academy_id uuid, p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.session_student_rosters ssr
    join public.class_sessions cs on cs.id = ssr.session_id
    join public.students s on s.id = ssr.student_id
    where ssr.academy_id = p_academy_id
      and ssr.student_id = p_student_id
      and ssr.is_expected
      and cs.academy_id = p_academy_id
      and s.academy_id = p_academy_id
      and private.teacher_has_session(cs.id)
  )
$$;

create or replace function private.teacher_has_subject_assignment(p_session_id uuid, p_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.session_subject_assignments ssa
    where ssa.session_id = p_session_id
      and ssa.subject_id = p_subject_id
      and ssa.teacher_id = private.current_profile_id()
      and private.has_academy_role(ssa.academy_id, array['teacher']::text[])
  )
$$;

create or replace function private.teacher_can_access_student_in_session(
  p_academy_id uuid,
  p_session_id uuid,
  p_student_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.session_student_rosters ssr
    join public.class_sessions cs on cs.id = ssr.session_id
    join public.students s on s.id = ssr.student_id
    where ssr.academy_id = p_academy_id
      and ssr.session_id = p_session_id
      and ssr.student_id = p_student_id
      and ssr.is_expected
      and cs.academy_id = p_academy_id
      and s.academy_id = p_academy_id
      and private.teacher_is_lead_for_session(cs.id)
  )
$$;

create or replace function private.teacher_can_manage_common_homework(
  p_academy_id uuid,
  p_class_id uuid,
  p_session_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.class_sessions cs
    where cs.id = p_session_id
      and cs.academy_id = p_academy_id
      and cs.class_id = p_class_id
      and private.teacher_is_lead_for_session(cs.id)
  )
$$;

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
      and g.academy_id = p_academy_id
      and s.academy_id = p_academy_id
      and g.auth_user_id = (select auth.uid())
  )
$$;

create or replace function private.guardian_can_view_bundle(p_bundle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.publication_bundles pb
    join public.students s on s.id = pb.student_id
    join public.class_sessions cs on cs.id = pb.session_id
    where pb.id = p_bundle_id
      and pb.status = 'published'
      and s.academy_id = pb.academy_id
      and cs.academy_id = pb.academy_id
      and private.guardian_can_view_student(pb.academy_id, pb.student_id)
  )
$$;

grant execute on function private.teacher_can_access_student_in_session(uuid, uuid, uuid) to authenticated;
grant execute on function private.teacher_can_manage_common_homework(uuid, uuid, uuid) to authenticated;

drop policy if exists session_subjects_select on public.session_subject_assignments;
create policy session_subjects_select on public.session_subject_assignments
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    teacher_id = private.current_profile_id()
    and private.has_academy_role(academy_id, array['teacher']::text[])
  )
);

drop policy if exists attendance_select on public.attendance_records;
create policy attendance_select on public.attendance_records
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_access_student_in_session(academy_id, session_id, student_id)
);

drop policy if exists attendance_insert on public.attendance_records;
create policy attendance_insert on public.attendance_records
for insert to authenticated
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_access_student_in_session(academy_id, session_id, student_id)
);

drop policy if exists attendance_update on public.attendance_records;
create policy attendance_update on public.attendance_records
for update to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_access_student_in_session(academy_id, session_id, student_id)
)
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_access_student_in_session(academy_id, session_id, student_id)
);

drop policy if exists homework_select on public.common_homework;
create policy homework_select on public.common_homework
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_manage_common_homework(academy_id, class_id, session_id)
);

drop policy if exists homework_insert on public.common_homework;
create policy homework_insert on public.common_homework
for insert to authenticated
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_manage_common_homework(academy_id, class_id, session_id)
);

drop policy if exists homework_update on public.common_homework;
create policy homework_update on public.common_homework
for update to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_manage_common_homework(academy_id, class_id, session_id)
)
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_manage_common_homework(academy_id, class_id, session_id)
);

drop policy if exists publication_bundles_select on public.publication_bundles;
create policy publication_bundles_select on public.publication_bundles
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.guardian_can_view_bundle(id)
);

drop policy if exists sessions_guardian_select on public.class_sessions;
create policy sessions_guardian_select on public.class_sessions
for select to authenticated
using (
  exists (
    select 1
    from public.publication_bundles pb
    where pb.session_id = class_sessions.id
      and pb.academy_id = class_sessions.academy_id
      and pb.status = 'published'
      and private.guardian_can_view_student(pb.academy_id, pb.student_id)
  )
);

drop policy if exists guardian_devices_select on public.guardian_devices;
create policy guardian_devices_select on public.guardian_devices
for select to authenticated
using (
  exists (
    select 1
    from public.guardians g
    where g.id = guardian_devices.guardian_id
      and g.academy_id = guardian_devices.academy_id
      and g.auth_user_id = (select auth.uid())
  )
  or private.has_academy_role(academy_id, array['academy_admin']::text[])
);

drop policy if exists guardian_devices_insert on public.guardian_devices;
create policy guardian_devices_insert on public.guardian_devices
for insert to authenticated
with check (
  exists (
    select 1
    from public.guardians g
    where g.id = guardian_devices.guardian_id
      and g.academy_id = guardian_devices.academy_id
      and g.auth_user_id = (select auth.uid())
  )
  or private.has_academy_role(academy_id, array['academy_admin']::text[])
);

drop policy if exists guardian_devices_update on public.guardian_devices;
create policy guardian_devices_update on public.guardian_devices
for update to authenticated
using (
  exists (
    select 1
    from public.guardians g
    where g.id = guardian_devices.guardian_id
      and g.academy_id = guardian_devices.academy_id
      and g.auth_user_id = (select auth.uid())
  )
  or private.has_academy_role(academy_id, array['academy_admin']::text[])
)
with check (
  exists (
    select 1
    from public.guardians g
    where g.id = guardian_devices.guardian_id
      and g.academy_id = guardian_devices.academy_id
      and g.auth_user_id = (select auth.uid())
  )
  or private.has_academy_role(academy_id, array['academy_admin']::text[])
);
