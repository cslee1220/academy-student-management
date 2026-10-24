-- A roster can be marked inactive when a future class move is prepared while
-- its start_date/end_date still make it valid for a past record date.
-- Guardian access must follow the effective date, not the current roster flag.
create or replace function private.guardian_can_view_daily_homework(
  p_academy_id uuid,
  p_class_id uuid,
  p_record_date date
)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select exists (
    select 1
    from public.class_schedule_blocks blocks
    join public.class_schedule_block_students block_students
      on block_students.block_id = blocks.id
     and block_students.academy_id = p_academy_id
     and p_record_date between block_students.start_date and coalesce(block_students.end_date, p_record_date)
    where blocks.academy_id = p_academy_id
      and blocks.class_id = p_class_id
      and blocks.is_active
      and p_record_date between blocks.effective_start and blocks.effective_end
      and private.guardian_can_view_published_daily_record(p_academy_id, block_students.student_id, p_record_date)
  );
$$;

create or replace function private.guardian_can_view_daily_homework_group(
  p_academy_id uuid,
  p_class_id uuid,
  p_record_date date,
  p_operation_group text
)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select exists (
    select 1
    from public.class_schedule_blocks blocks
    join public.class_schedule_block_students block_students
      on block_students.block_id = blocks.id
     and block_students.academy_id = p_academy_id
     and p_record_date between block_students.start_date and coalesce(block_students.end_date, p_record_date)
     and (p_operation_group = 'common' or block_students.operation_group = p_operation_group)
    where blocks.academy_id = p_academy_id
      and blocks.class_id = p_class_id
      and blocks.is_active
      and p_record_date between blocks.effective_start and blocks.effective_end
      and private.guardian_can_view_published_daily_record(p_academy_id, block_students.student_id, p_record_date)
  );
$$;
