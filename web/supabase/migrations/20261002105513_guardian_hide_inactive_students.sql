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
      and s.academy_id = sg.academy_id
    where sg.academy_id = p_academy_id
      and sg.student_id = p_student_id
      and sg.is_active
      and s.current_status not in ('paused', 'on_hold', 'withdrawn')
      and g.auth_user_id = (select auth.uid())
  )
$$;
