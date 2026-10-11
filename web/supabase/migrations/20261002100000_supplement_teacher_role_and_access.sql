-- Allow an academy to assign a dedicated supplementary teacher.
-- The dedicated role cannot use normal class-record APIs; it can only manage
-- completion state on student_supplement_tasks through the supplements route.

alter table public.academy_memberships
  drop constraint if exists academy_memberships_role_check;

alter table public.academy_memberships
  add constraint academy_memberships_role_check
  check (role in ('system_admin', 'academy_admin', 'teacher', 'supplement_teacher'));

drop policy if exists academies_select on public.academies;
create policy academies_select on public.academies
for select to authenticated
using (private.has_academy_role(id, array['academy_admin', 'teacher', 'supplement_teacher']::text[]));

drop policy if exists memberships_insert on public.academy_memberships;
create policy memberships_insert on public.academy_memberships
for insert to authenticated
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  and role in ('academy_admin', 'teacher', 'supplement_teacher')
);

drop policy if exists memberships_update on public.academy_memberships;
create policy memberships_update on public.academy_memberships
for update to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  and role in ('academy_admin', 'teacher', 'supplement_teacher')
);

create or replace function private.supplement_teacher_can_access_supplement_task(
  p_academy_id uuid,
  p_task_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.student_supplement_tasks t
    where t.id = p_task_id
      and t.academy_id = p_academy_id
      and private.has_academy_role(p_academy_id, array['supplement_teacher']::text[])
  );
$$;

grant execute on function private.supplement_teacher_can_access_supplement_task(uuid, uuid) to authenticated;

drop policy if exists supplement_tasks_select on public.student_supplement_tasks;
create policy supplement_tasks_select on public.student_supplement_tasks
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_access_supplement_task(academy_id, id)
  or private.supplement_teacher_can_access_supplement_task(academy_id, id)
);

drop policy if exists supplement_tasks_update on public.student_supplement_tasks;
create policy supplement_tasks_update on public.student_supplement_tasks
for update to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_access_supplement_task(academy_id, id)
  or private.supplement_teacher_can_access_supplement_task(academy_id, id)
)
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_access_supplement_task(academy_id, id)
  or private.supplement_teacher_can_access_supplement_task(academy_id, id)
);
