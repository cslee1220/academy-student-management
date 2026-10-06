-- The preceding operation-schedule migration owns the validity columns and
-- their term-based backfill. This migration adds the date-based roster
-- authorization and its supporting assignment index.
create index if not exists student_class_assignments_daily_roster_idx
  on public.student_class_assignments (academy_id, class_id, student_id, status, start_date, end_date);

create or replace function private.validate_daily_block_academy()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.class_schedule_blocks b
    where b.id = new.block_id and b.academy_id = new.academy_id
  ) then
    raise exception 'daily record block must belong to the same academy' using errcode = '23503';
  end if;
  if not exists (
    select 1 from public.students s
    where s.id = new.student_id and s.academy_id = new.academy_id
  ) then
    raise exception 'daily record student must belong to the same academy' using errcode = '23503';
  end if;
  if not exists (
    select 1
    from public.class_schedule_blocks selected_block
    join public.student_class_assignments assignment
      on assignment.academy_id = selected_block.academy_id
     and assignment.class_id = selected_block.class_id
     and assignment.student_id = new.student_id
     and assignment.status in ('active', 'ended')
     and new.record_date between assignment.start_date and coalesce(assignment.end_date, new.record_date)
    where selected_block.id = new.block_id
      and selected_block.academy_id = new.academy_id
      and selected_block.is_active
      and new.record_date between selected_block.effective_start and selected_block.effective_end
  ) then
    raise exception 'daily record student is not assigned to the class on the record date' using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists daily_attendance_validate_academy on public.daily_attendance_records;
create trigger daily_attendance_validate_academy
before insert or update of academy_id, block_id, student_id, record_date on public.daily_attendance_records
for each row execute function private.validate_daily_block_academy();

drop trigger if exists daily_subject_validate_academy on public.daily_subject_records;
create trigger daily_subject_validate_academy
before insert or update of academy_id, block_id, student_id, record_date on public.daily_subject_records
for each row execute function private.validate_daily_block_academy();

create or replace function private.teacher_can_access_daily_block(
  p_academy_id uuid,
  p_block_id uuid,
  p_student_id uuid,
  p_record_date date
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.class_schedule_blocks b
    join public.student_class_assignments assignment
      on assignment.academy_id = b.academy_id
     and assignment.class_id = b.class_id
     and assignment.student_id = p_student_id
     and assignment.status in ('active', 'ended')
     and p_record_date between assignment.start_date and coalesce(assignment.end_date, p_record_date)
    where b.id = p_block_id
      and b.academy_id = p_academy_id
      and b.teacher_id = private.current_profile_id()
      and b.is_active
      and p_record_date between b.effective_start and b.effective_end
      and private.has_academy_role(p_academy_id, array['teacher']::text[])
  )
$$;

create or replace function private.teacher_can_access_daily_student(
  p_academy_id uuid,
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
    from public.class_schedule_blocks b
    join public.student_class_assignments assignment
      on assignment.academy_id = b.academy_id
     and assignment.class_id = b.class_id
     and assignment.student_id = p_student_id
     and assignment.status in ('active', 'ended')
    where b.academy_id = p_academy_id
      and b.teacher_id = private.current_profile_id()
      and b.is_active
      and private.has_academy_role(p_academy_id, array['teacher']::text[])
  )
$$;

create or replace function private.teacher_can_access_class_on_date(
  p_academy_id uuid,
  p_class_id uuid,
  p_record_date date
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.class_schedule_blocks b
    join public.student_class_assignments assignment
      on assignment.academy_id = b.academy_id
     and assignment.class_id = b.class_id
     and assignment.status in ('active', 'ended')
     and p_record_date between assignment.start_date and coalesce(assignment.end_date, p_record_date)
    where b.academy_id = p_academy_id
      and b.class_id = p_class_id
      and b.teacher_id = private.current_profile_id()
      and b.is_active
      and p_record_date between b.effective_start and b.effective_end
      and private.has_academy_role(p_academy_id, array['teacher']::text[])
  )
$$;
