-- Store attendance independently for each subject teacher assigned to a session.
-- Existing legacy rows without a subject_id remain readable during migration.

alter table public.attendance_records
  add column subject_id uuid references public.subjects (id) on delete restrict;

alter table public.attendance_records
  drop constraint if exists attendance_records_academy_id_student_id_session_id_key;

create unique index attendance_records_subject_scope_uidx
  on public.attendance_records (academy_id, student_id, session_id, subject_id)
  where subject_id is not null;

create index attendance_records_subject_lookup_idx
  on public.attendance_records (academy_id, session_id, subject_id, student_id);

create or replace function private.validate_attendance_subject()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.subject_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.subjects s
    where s.id = new.subject_id
      and s.academy_id = new.academy_id
  ) then
    raise exception 'attendance subject must belong to the same academy' using errcode = '23503';
  end if;

  if not exists (
    select 1
    from public.session_subject_assignments ssa
    where ssa.academy_id = new.academy_id
      and ssa.session_id = new.session_id
      and ssa.subject_id = new.subject_id
  ) then
    raise exception 'attendance subject must be assigned to the session' using errcode = '23503';
  end if;

  return new;
end;
$$;

create trigger attendance_records_validate_subject
before insert or update of academy_id, session_id, subject_id on public.attendance_records
for each row execute function private.validate_attendance_subject();

create or replace function private.teacher_can_access_subject_student_in_session(
  p_academy_id uuid,
  p_session_id uuid,
  p_student_id uuid,
  p_subject_id uuid
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
    join public.session_subject_assignments ssa
      on ssa.session_id = ssr.session_id
     and ssa.subject_id = p_subject_id
     and ssa.teacher_id = private.current_profile_id()
    where ssr.academy_id = p_academy_id
      and ssr.session_id = p_session_id
      and ssr.student_id = p_student_id
      and ssr.is_expected
      and cs.academy_id = p_academy_id
      and s.academy_id = p_academy_id
      and ssa.academy_id = p_academy_id
      and private.has_academy_role(p_academy_id, array['teacher']::text[])
  )
$$;

grant execute on function private.teacher_can_access_subject_student_in_session(uuid, uuid, uuid, uuid) to authenticated;

drop policy if exists attendance_select on public.attendance_records;
create policy attendance_select on public.attendance_records
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    subject_id is not null
    and private.teacher_can_access_subject_student_in_session(academy_id, session_id, student_id, subject_id)
  )
  or (
    subject_id is null
    and private.teacher_can_access_student_in_session(academy_id, session_id, student_id)
  )
);

drop policy if exists attendance_insert on public.attendance_records;
create policy attendance_insert on public.attendance_records
for insert to authenticated
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    subject_id is not null
    and private.teacher_can_access_subject_student_in_session(academy_id, session_id, student_id, subject_id)
  )
  or (
    subject_id is null
    and private.teacher_can_access_student_in_session(academy_id, session_id, student_id)
  )
);

drop policy if exists attendance_update on public.attendance_records;
create policy attendance_update on public.attendance_records
for update to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    subject_id is not null
    and private.teacher_can_access_subject_student_in_session(academy_id, session_id, student_id, subject_id)
  )
  or (
    subject_id is null
    and private.teacher_can_access_student_in_session(academy_id, session_id, student_id)
  )
)
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    subject_id is not null
    and private.teacher_can_access_subject_student_in_session(academy_id, session_id, student_id, subject_id)
  )
  or (
    subject_id is null
    and private.teacher_can_access_student_in_session(academy_id, session_id, student_id)
  )
);

drop policy if exists homework_select on public.common_homework;
create policy homework_select on public.common_homework
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    exists (
      select 1
      from public.class_sessions cs
      where cs.id = session_id
        and cs.academy_id = academy_id
        and cs.class_id = class_id
    )
    and private.teacher_has_session(session_id)
  )
);

comment on column public.attendance_records.subject_id is
  '과목별 출결 담당 범위. NULL은 이전 공통 출결 데이터 호환용.';
