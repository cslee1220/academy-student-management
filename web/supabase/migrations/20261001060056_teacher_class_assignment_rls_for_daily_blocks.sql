-- Teachers who receive the new date-based schedule blocks must also be able
-- to read the class assignments used to build their daily roster. The legacy
-- implementation only looked at class_sessions, so the API silently received
-- an empty assignment result for classes that only have class_schedule_blocks.
create or replace function private.teacher_has_class(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.class_sessions cs
    where cs.class_id = p_class_id
      and (
        cs.lead_teacher_id = private.current_profile_id()
        or exists (
          select 1
          from public.session_subject_assignments ssa
          where ssa.session_id = cs.id
            and ssa.teacher_id = private.current_profile_id()
        )
      )
  )
  or exists (
    select 1
    from public.class_schedule_blocks b
    where b.class_id = p_class_id
      and b.teacher_id = private.current_profile_id()
      and b.is_active
  )
$$;
