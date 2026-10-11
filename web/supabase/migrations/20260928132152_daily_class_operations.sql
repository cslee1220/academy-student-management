-- Date-based class operations for the simplified workflow.
-- Legacy class_sessions/publication tables remain intact for historical data.

create table public.class_schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  class_id uuid not null references public.classes (id) on delete restrict,
  subject_id uuid not null references public.subjects (id) on delete restrict,
  teacher_id uuid not null references public.profiles (id) on delete restrict,
  classroom_id uuid references public.classrooms (id) on delete restrict,
  classroom_name_snapshot text,
  class_name_snapshot text not null,
  subject_name_snapshot text not null,
  teacher_name_snapshot text not null,
  weekday text not null check (weekday in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')),
  start_time time not null,
  end_time time not null,
  effective_start date not null,
  effective_end date not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, class_id, subject_id, teacher_id, weekday, start_time, effective_start),
  check (start_time < end_time),
  check (effective_start <= effective_end)
);

create table public.class_schedule_block_students (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  block_id uuid not null references public.class_schedule_blocks (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  start_date date not null,
  end_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (block_id, student_id, start_date),
  check (end_date is null or start_date <= end_date)
);

create table public.daily_attendance_records (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  block_id uuid not null references public.class_schedule_blocks (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  record_date date not null,
  attendance_status text not null check (attendance_status in ('present', 'absent', 'unexcused_absent')),
  absence_note text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, block_id, student_id, record_date)
);

create table public.daily_common_homework (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  class_id uuid not null references public.classes (id) on delete restrict,
  record_date date not null,
  content text,
  no_homework boolean not null default false,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, class_id, record_date)
);

create table public.daily_subject_records (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  block_id uuid not null references public.class_schedule_blocks (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  record_date date not null,
  subject_id uuid not null references public.subjects (id) on delete restrict,
  teacher_id uuid not null references public.profiles (id) on delete restrict,
  subject_name_snapshot text not null,
  teacher_name_snapshot text not null,
  homework_score smallint check (homework_score between 1 and 5),
  understanding_score smallint check (understanding_score between 1 and 5),
  participation_score smallint check (participation_score between 1 and 5),
  is_supplementary boolean not null default false,
  public_note text,
  test_definitions jsonb not null default '[]'::jsonb,
  test_results jsonb not null default '[]'::jsonb,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, block_id, student_id, record_date)
);

create or replace function private.validate_class_schedule_block()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.classes c
    where c.id = new.class_id and c.academy_id = new.academy_id
  ) then
    raise exception 'schedule block class must belong to the same academy' using errcode = '23503';
  end if;
  if not exists (
    select 1 from public.subjects s
    where s.id = new.subject_id and s.academy_id = new.academy_id
  ) then
    raise exception 'schedule block subject must belong to the same academy' using errcode = '23503';
  end if;
  if not exists (
    select 1 from public.profiles p
    join public.academy_memberships am on am.profile_id = p.id
    where p.id = new.teacher_id
      and am.academy_id = new.academy_id
      and am.role = 'teacher'
      and am.is_active
  ) then
    raise exception 'schedule block teacher must be an active academy teacher' using errcode = '23503';
  end if;
  if new.classroom_id is not null and not exists (
    select 1 from public.classrooms cr
    where cr.id = new.classroom_id and cr.academy_id = new.academy_id
  ) then
    raise exception 'schedule block classroom must belong to the same academy' using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger class_schedule_blocks_validate
before insert or update of academy_id, class_id, subject_id, teacher_id, classroom_id
on public.class_schedule_blocks
for each row execute function private.validate_class_schedule_block();

create or replace function private.validate_schedule_block_student()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.class_schedule_blocks b
    where b.id = new.block_id and b.academy_id = new.academy_id
  ) then
    raise exception 'schedule block student block must belong to the same academy' using errcode = '23503';
  end if;
  if not exists (
    select 1 from public.students s
    where s.id = new.student_id and s.academy_id = new.academy_id
  ) then
    raise exception 'schedule block student must belong to the same academy' using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger class_schedule_block_students_validate
before insert or update of academy_id, block_id, student_id
on public.class_schedule_block_students
for each row execute function private.validate_schedule_block_student();

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
    from public.class_schedule_block_students bs
    where bs.block_id = new.block_id
      and bs.academy_id = new.academy_id
      and bs.student_id = new.student_id
      and bs.is_active
      and new.record_date between bs.start_date and coalesce(bs.end_date, new.record_date)
  ) then
    raise exception 'daily record student is not assigned to the block on the record date' using errcode = '23503';
  end if;
  if not exists (
    select 1
    from public.class_schedule_blocks b
    where b.id = new.block_id
      and b.academy_id = new.academy_id
      and b.is_active
      and new.record_date between b.effective_start and b.effective_end
  ) then
    raise exception 'daily record date is outside the active block period' using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger daily_attendance_validate_academy
before insert or update of academy_id, block_id, student_id on public.daily_attendance_records
for each row execute function private.validate_daily_block_academy();

create trigger daily_subject_validate_academy
before insert or update of academy_id, block_id, student_id on public.daily_subject_records
for each row execute function private.validate_daily_block_academy();

create or replace function private.validate_daily_subject_block()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.class_schedule_blocks b
    where b.id = new.block_id
      and b.academy_id = new.academy_id
      and b.subject_id = new.subject_id
      and b.teacher_id = new.teacher_id
  ) then
    raise exception 'daily subject record subject and teacher must match the block' using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger daily_subject_validate_block
before insert or update of academy_id, block_id, subject_id, teacher_id
on public.daily_subject_records
for each row execute function private.validate_daily_subject_block();

create or replace function private.validate_daily_homework_class()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.classes c
    where c.id = new.class_id and c.academy_id = new.academy_id
  ) then
    raise exception 'daily homework class must belong to the same academy' using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger daily_common_homework_validate_class
before insert or update of academy_id, class_id on public.daily_common_homework
for each row execute function private.validate_daily_homework_class();

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
    join public.class_schedule_block_students bs on bs.block_id = b.id
    where b.id = p_block_id
      and b.academy_id = p_academy_id
      and b.teacher_id = private.current_profile_id()
      and b.is_active
      and p_record_date between b.effective_start and b.effective_end
      and bs.academy_id = p_academy_id
      and bs.student_id = p_student_id
      and bs.is_active
      and p_record_date between bs.start_date and coalesce(bs.end_date, p_record_date)
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
    join public.class_schedule_block_students bs on bs.block_id = b.id
    where b.academy_id = p_academy_id
      and b.teacher_id = private.current_profile_id()
      and b.is_active
      and bs.academy_id = p_academy_id
      and bs.student_id = p_student_id
      and bs.is_active
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
    where b.academy_id = p_academy_id
      and b.class_id = p_class_id
      and b.teacher_id = private.current_profile_id()
      and b.is_active
      and p_record_date between b.effective_start and b.effective_end
      and private.has_academy_role(p_academy_id, array['teacher']::text[])
  )
$$;

grant execute on function private.teacher_can_access_daily_block(uuid, uuid, uuid, date) to authenticated;
grant execute on function private.teacher_can_access_daily_student(uuid, uuid) to authenticated;
grant execute on function private.teacher_can_access_class_on_date(uuid, uuid, date) to authenticated;

create trigger class_schedule_blocks_set_updated_at before update on public.class_schedule_blocks
for each row execute function private.set_updated_at();
create trigger class_schedule_block_students_set_updated_at before update on public.class_schedule_block_students
for each row execute function private.set_updated_at();
create trigger daily_attendance_set_updated_at before update on public.daily_attendance_records
for each row execute function private.set_updated_at();
create trigger daily_common_homework_set_updated_at before update on public.daily_common_homework
for each row execute function private.set_updated_at();
create trigger daily_subject_records_set_updated_at before update on public.daily_subject_records
for each row execute function private.set_updated_at();

create index class_schedule_blocks_teacher_date_idx
  on public.class_schedule_blocks (academy_id, teacher_id, is_active, effective_start, effective_end);
create index class_schedule_block_students_student_date_idx
  on public.class_schedule_block_students (academy_id, student_id, is_active, start_date, end_date);
create index daily_attendance_lookup_idx
  on public.daily_attendance_records (academy_id, student_id, record_date, block_id);
create index daily_subject_lookup_idx
  on public.daily_subject_records (academy_id, student_id, record_date, block_id);

alter table public.class_schedule_blocks enable row level security;
alter table public.class_schedule_block_students enable row level security;
alter table public.daily_attendance_records enable row level security;
alter table public.daily_common_homework enable row level security;
alter table public.daily_subject_records enable row level security;

revoke all on table public.class_schedule_blocks, public.class_schedule_block_students,
  public.daily_attendance_records, public.daily_common_homework, public.daily_subject_records
  from anon, authenticated;
grant select, insert, update on table public.class_schedule_blocks, public.class_schedule_block_students,
  public.daily_attendance_records, public.daily_common_homework, public.daily_subject_records
  to authenticated;

create or replace function private.guardian_can_view_schedule_block(
  p_academy_id uuid,
  p_block_id uuid
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
    join public.class_schedule_block_students bs on bs.block_id = b.id
    where b.id = p_block_id
      and b.academy_id = p_academy_id
      and b.is_active
      and bs.academy_id = p_academy_id
      and bs.is_active
      and private.guardian_can_view_student(p_academy_id, bs.student_id)
  )
$$;

create or replace function private.guardian_can_view_schedule_block_student(
  p_academy_id uuid,
  p_block_id uuid,
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
    join public.class_schedule_block_students bs on bs.block_id = b.id
    where b.id = p_block_id
      and b.academy_id = p_academy_id
      and b.is_active
      and bs.academy_id = p_academy_id
      and bs.student_id = p_student_id
      and bs.is_active
      and private.guardian_can_view_student(p_academy_id, p_student_id)
  )
$$;

create or replace function private.teacher_can_view_schedule_block_student(
  p_block_id uuid,
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
    join public.class_schedule_block_students bs on bs.block_id = b.id
    where b.id = p_block_id
      and b.teacher_id = private.current_profile_id()
      and b.is_active
      and bs.student_id = p_student_id
      and bs.is_active
      and private.has_academy_role(b.academy_id, array['teacher']::text[])
  )
$$;

create or replace function private.guardian_can_view_daily_homework(
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
    join public.class_schedule_block_students bs on bs.block_id = b.id
    where b.academy_id = p_academy_id
      and b.class_id = p_class_id
      and b.is_active
      and p_record_date between b.effective_start and b.effective_end
      and bs.academy_id = p_academy_id
      and bs.is_active
      and p_record_date between bs.start_date and coalesce(bs.end_date, p_record_date)
      and private.guardian_can_view_student(p_academy_id, bs.student_id)
  )
$$;

grant execute on function private.guardian_can_view_schedule_block(uuid, uuid) to authenticated;
grant execute on function private.guardian_can_view_schedule_block_student(uuid, uuid, uuid) to authenticated;
grant execute on function private.teacher_can_view_schedule_block_student(uuid, uuid) to authenticated;
grant execute on function private.guardian_can_view_daily_homework(uuid, uuid, date) to authenticated;

create policy daily_blocks_admin on public.class_schedule_blocks
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));

create policy daily_blocks_teacher_select on public.class_schedule_blocks
for select to authenticated
using (teacher_id = private.current_profile_id() and private.has_academy_role(academy_id, array['teacher']::text[]));

create policy students_daily_select on public.students
for select to authenticated
using (private.teacher_can_access_daily_student(academy_id, id));

create policy daily_blocks_guardian_select on public.class_schedule_blocks
for select to authenticated
using (private.guardian_can_view_schedule_block(academy_id, id));

create policy daily_block_students_admin on public.class_schedule_block_students
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));

create policy daily_block_students_teacher_select on public.class_schedule_block_students
for select to authenticated
using (private.teacher_can_view_schedule_block_student(block_id, student_id));

create policy daily_block_students_guardian_select on public.class_schedule_block_students
for select to authenticated
using (private.guardian_can_view_schedule_block_student(academy_id, block_id, student_id));

create policy daily_attendance_access on public.daily_attendance_records
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_access_daily_block(academy_id, block_id, student_id, record_date)
  or private.guardian_can_view_student(academy_id, student_id)
);

create policy daily_attendance_write on public.daily_attendance_records
for insert to authenticated
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_access_daily_block(academy_id, block_id, student_id, record_date)
);

create policy daily_attendance_update on public.daily_attendance_records
for update to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_access_daily_block(academy_id, block_id, student_id, record_date)
)
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_access_daily_block(academy_id, block_id, student_id, record_date)
);

create policy daily_homework_access on public.daily_common_homework
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_access_class_on_date(academy_id, class_id, record_date)
  or private.guardian_can_view_daily_homework(academy_id, class_id, record_date)
);

create policy daily_homework_write on public.daily_common_homework
for all to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_access_class_on_date(academy_id, class_id, record_date)
)
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_access_class_on_date(academy_id, class_id, record_date)
);

create policy daily_subject_access on public.daily_subject_records
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_access_daily_block(academy_id, block_id, student_id, record_date)
  or private.guardian_can_view_student(academy_id, student_id)
);

create policy daily_subject_write on public.daily_subject_records
for insert to authenticated
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_access_daily_block(academy_id, block_id, student_id, record_date)
);

create policy daily_subject_update on public.daily_subject_records
for update to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_access_daily_block(academy_id, block_id, student_id, record_date)
)
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_access_daily_block(academy_id, block_id, student_id, record_date)
);

-- Backfill the date-based model from existing schedule and record history.
insert into public.class_schedule_blocks (
  academy_id, class_id, subject_id, teacher_id, class_name_snapshot,
  subject_name_snapshot, teacher_name_snapshot, weekday, start_time, end_time,
  effective_start, effective_end
)
select distinct on (cs.academy_id, cs.class_id, ssa.subject_id, ssa.teacher_id,
                    case extract(isodow from cs.session_date)
                      when 1 then 'mon' when 2 then 'tue' when 3 then 'wed'
                      when 4 then 'thu' when 5 then 'fri' when 6 then 'sat' else 'sun' end,
                    cs.start_time, t.start_date)
  cs.academy_id, cs.class_id, ssa.subject_id, ssa.teacher_id,
  c.name, ssa.subject_name_snapshot, ssa.teacher_name_snapshot,
  case extract(isodow from cs.session_date)
    when 1 then 'mon' when 2 then 'tue' when 3 then 'wed'
    when 4 then 'thu' when 5 then 'fri' when 6 then 'sat' else 'sun' end,
  cs.start_time, cs.end_time, t.start_date, t.end_date
from public.class_sessions cs
join public.classes c on c.id = cs.class_id and c.academy_id = cs.academy_id
join public.terms t on t.id = cs.term_id and t.academy_id = cs.academy_id
join public.session_subject_assignments ssa on ssa.session_id = cs.id and ssa.academy_id = cs.academy_id
where cs.academy_id = ssa.academy_id
order by cs.academy_id, cs.class_id, ssa.subject_id, ssa.teacher_id,
  case extract(isodow from cs.session_date)
    when 1 then 'mon' when 2 then 'tue' when 3 then 'wed'
    when 4 then 'thu' when 5 then 'fri' when 6 then 'sat' else 'sun' end,
  cs.start_time, t.start_date, cs.session_date;

insert into public.class_schedule_block_students (academy_id, block_id, student_id, start_date, end_date)
select b.academy_id, b.id, ssr.student_id, min(cs.session_date), null
from public.class_schedule_blocks b
join public.class_sessions cs
  on cs.academy_id = b.academy_id
 and cs.class_id = b.class_id
 and cs.start_time = b.start_time
 and cs.end_time = b.end_time
 and cs.session_date between b.effective_start and b.effective_end
join public.session_subject_assignments ssa
  on ssa.academy_id = b.academy_id
 and ssa.session_id = cs.id
 and ssa.subject_id = b.subject_id
 and ssa.teacher_id = b.teacher_id
join public.session_student_rosters ssr on ssr.academy_id = b.academy_id and ssr.session_id = cs.id and ssr.is_expected
where case extract(isodow from cs.session_date)
    when 1 then 'mon' when 2 then 'tue' when 3 then 'wed'
    when 4 then 'thu' when 5 then 'fri' when 6 then 'sat' else 'sun' end = b.weekday
group by b.academy_id, b.id, ssr.student_id
on conflict (block_id, student_id, start_date) do nothing;

insert into public.daily_attendance_records (
  academy_id, block_id, student_id, record_date, attendance_status, absence_note, version
)
select b.academy_id, b.id, ssr.student_id, cs.session_date,
  coalesce(ar.attendance_status, 'present'), ar.absence_note, coalesce(ar.version, 1)
from public.class_schedule_blocks b
join public.class_sessions cs
  on cs.academy_id = b.academy_id and cs.class_id = b.class_id
 and cs.start_time = b.start_time and cs.end_time = b.end_time
 and cs.session_date between b.effective_start and b.effective_end
join public.session_subject_assignments ssa
  on ssa.academy_id = b.academy_id and ssa.session_id = cs.id
 and ssa.subject_id = b.subject_id and ssa.teacher_id = b.teacher_id
join public.session_student_rosters ssr on ssr.academy_id = b.academy_id and ssr.session_id = cs.id and ssr.is_expected
left join public.attendance_records ar
  on ar.academy_id = b.academy_id and ar.session_id = cs.id and ar.student_id = ssr.student_id
 and (ar.subject_id = b.subject_id or ar.subject_id is null)
where case extract(isodow from cs.session_date)
    when 1 then 'mon' when 2 then 'tue' when 3 then 'wed'
    when 4 then 'thu' when 5 then 'fri' when 6 then 'sat' else 'sun' end = b.weekday
on conflict (academy_id, block_id, student_id, record_date) do nothing;

insert into public.daily_common_homework (academy_id, class_id, record_date, content, no_homework, version)
select ch.academy_id, ch.class_id, cs.session_date,
  ch.content, ch.no_homework, ch.version
from public.common_homework ch
join public.class_sessions cs on cs.id = ch.session_id and cs.academy_id = ch.academy_id
on conflict (academy_id, class_id, record_date) do nothing;

insert into public.daily_subject_records (
  academy_id, block_id, student_id, record_date, subject_id, teacher_id,
  subject_name_snapshot, teacher_name_snapshot, homework_score,
  understanding_score, participation_score, is_supplementary, public_note,
  test_definitions, test_results, version
)
select b.academy_id, b.id, tsr.student_id, cs.session_date, tsr.subject_id, tsr.teacher_id,
  coalesce((select s.name from public.subjects s where s.id = tsr.subject_id), b.subject_name_snapshot),
  b.teacher_name_snapshot, tsr.homework_score,
  tsr.understanding_score, tsr.participation_score, tsr.is_supplementary, tsr.public_note,
  coalesce((select jsonb_agg(jsonb_build_object('id', td.id, 'sequenceNo', td.sequence_no, 'name', td.name, 'maxScore', td.max_score) order by td.sequence_no)
            from public.test_definitions td where td.session_id = cs.id and td.subject_id = tsr.subject_id and td.teacher_id = tsr.teacher_id), '[]'::jsonb),
  coalesce((select jsonb_agg(jsonb_build_object('testDefinitionId', str.test_definition_id, 'score', str.score, 'nonAttemptReason', str.non_attempt_reason))
            from public.student_test_results str join public.test_definitions td on td.id = str.test_definition_id
            where td.session_id = cs.id and td.subject_id = tsr.subject_id and td.teacher_id = tsr.teacher_id and str.student_id = tsr.student_id), '[]'::jsonb),
  tsr.version
from public.teacher_subject_records tsr
join public.class_sessions cs on cs.id = tsr.session_id and cs.academy_id = tsr.academy_id
join public.class_schedule_blocks b
  on b.academy_id = tsr.academy_id and b.class_id = cs.class_id
 and b.subject_id = tsr.subject_id and b.teacher_id = tsr.teacher_id
 and b.start_time = cs.start_time and b.end_time = cs.end_time
 and cs.session_date between b.effective_start and b.effective_end
where case extract(isodow from cs.session_date)
    when 1 then 'mon' when 2 then 'tue' when 3 then 'wed'
    when 4 then 'thu' when 5 then 'fri' when 6 then 'sat' else 'sun' end = b.weekday
on conflict (academy_id, block_id, student_id, record_date) do nothing;
