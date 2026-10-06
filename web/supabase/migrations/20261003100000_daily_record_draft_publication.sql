begin;

alter table public.daily_attendance_records
  add column save_state text not null default 'final'
  check (save_state in ('draft', 'final'));
alter table public.daily_attendance_records
  alter column save_state set default 'draft';

alter table public.daily_subject_records
  add column save_state text not null default 'final'
  check (save_state in ('draft', 'final'));
alter table public.daily_subject_records
  alter column save_state set default 'draft';

alter table public.daily_common_homework
  add column save_state text not null default 'final'
  check (save_state in ('draft', 'final'));
alter table public.daily_common_homework
  alter column save_state set default 'draft';

create table public.daily_record_publications (
  academy_id uuid not null references public.academies (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  record_date date not null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  updated_by_profile_id uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (academy_id, student_id, record_date)
);

create index daily_record_publications_student_date_idx
  on public.daily_record_publications (academy_id, student_id, record_date, status);

create trigger daily_record_publications_set_updated_at
before update on public.daily_record_publications
for each row execute function private.set_updated_at();

-- Preserve the records guardians could already read before this migration.
insert into public.daily_record_publications (academy_id, student_id, record_date, status)
select existing_days.academy_id, existing_days.student_id, existing_days.record_date, 'published'
from (
  select academy_id, student_id, record_date from public.daily_attendance_records
  union
  select academy_id, student_id, record_date from public.daily_subject_records
  union
  select homework.academy_id, block_students.student_id, homework.record_date
  from public.daily_common_homework homework
  join public.class_schedule_blocks blocks
    on blocks.academy_id = homework.academy_id
   and blocks.class_id = homework.class_id
  join public.class_schedule_block_students block_students
    on block_students.academy_id = homework.academy_id
   and block_students.block_id = blocks.id
   and block_students.is_active
   and homework.record_date between block_students.start_date and coalesce(block_students.end_date, homework.record_date)
) existing_days
on conflict (academy_id, student_id, record_date) do nothing;

create or replace function private.guardian_can_view_published_daily_record(
  p_academy_id uuid,
  p_student_id uuid,
  p_record_date date
)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select private.guardian_can_view_student(p_academy_id, p_student_id)
    and exists (
      select 1
      from public.daily_record_publications publication
      where publication.academy_id = p_academy_id
        and publication.student_id = p_student_id
        and publication.record_date = p_record_date
        and publication.status = 'published'
    );
$$;

grant execute on function private.guardian_can_view_published_daily_record(uuid, uuid, date) to authenticated;

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
     and block_students.is_active
     and p_record_date between block_students.start_date and coalesce(block_students.end_date, p_record_date)
    where blocks.academy_id = p_academy_id
      and blocks.class_id = p_class_id
      and blocks.is_active
      and p_record_date between blocks.effective_start and blocks.effective_end
      and private.guardian_can_view_published_daily_record(p_academy_id, block_students.student_id, p_record_date)
  );
$$;

grant execute on function private.guardian_can_view_daily_homework(uuid, uuid, date) to authenticated;

alter table public.daily_record_publications enable row level security;
revoke all on table public.daily_record_publications from anon, authenticated;
grant select on table public.daily_record_publications to authenticated;
grant select, insert, update on table public.daily_record_publications to service_role;

create policy daily_record_publications_admin_select
on public.daily_record_publications
for select to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]));

create policy daily_record_publications_guardian_select
on public.daily_record_publications
for select to authenticated
using (
  status = 'published'
  and private.guardian_can_view_student(academy_id, student_id)
);

drop policy if exists daily_attendance_access on public.daily_attendance_records;
create policy daily_attendance_access on public.daily_attendance_records
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_access_daily_block(academy_id, block_id, student_id, record_date)
  or (
    save_state = 'final'
    and private.guardian_can_view_published_daily_record(academy_id, student_id, record_date)
  )
);

drop policy if exists daily_subject_access on public.daily_subject_records;
create policy daily_subject_access on public.daily_subject_records
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_access_daily_block(academy_id, block_id, student_id, record_date)
  or (
    save_state = 'final'
    and private.guardian_can_view_published_daily_record(academy_id, student_id, record_date)
  )
);

drop policy if exists daily_homework_access on public.daily_common_homework;
create policy daily_homework_access on public.daily_common_homework
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_access_class_on_date(academy_id, class_id, record_date)
  or (
    save_state = 'final'
    and private.guardian_can_view_daily_homework(academy_id, class_id, record_date)
  )
);

-- Daily records are written only after the server checks the teacher assignment,
-- student roster, date, weekday, and version. Do not permit direct client writes.
revoke insert, update on table public.daily_attendance_records,
  public.daily_common_homework, public.daily_subject_records
  from anon, authenticated;
grant insert, update on table public.daily_attendance_records,
  public.daily_common_homework, public.daily_subject_records
  to service_role;

commit;