-- Classrooms belong to the class subject assignment, not to an individual
-- student. A class can therefore use one room for grammar and another for
-- reading while students keep a single active class assignment.
create table public.class_subject_classroom_assignments (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  class_id uuid not null references public.classes (id) on delete restrict,
  subject_id uuid not null references public.subjects (id) on delete restrict,
  classroom_id uuid not null references public.classrooms (id) on delete restrict,
  effective_start date not null default current_date,
  effective_end date,
  is_active boolean not null default true,
  updated_by_profile_id uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_end is null or effective_start <= effective_end),
  unique (academy_id, class_id, subject_id, effective_start)
);

create index class_subject_classroom_assignments_active_idx
  on public.class_subject_classroom_assignments (academy_id, class_id, subject_id, is_active);

create trigger class_subject_classroom_assignments_set_updated_at
before update on public.class_subject_classroom_assignments
for each row execute function private.set_updated_at();

create or replace function private.validate_class_subject_classroom_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not exists (
    select 1 from public.classes c
    where c.id = new.class_id and c.academy_id = new.academy_id
  ) then
    raise exception 'class academy mismatch';
  end if;

  if not exists (
    select 1 from public.subjects s
    where s.id = new.subject_id and s.academy_id = new.academy_id
  ) then
    raise exception 'subject academy mismatch';
  end if;

  if not exists (
    select 1 from public.classrooms cr
    where cr.id = new.classroom_id and cr.academy_id = new.academy_id
  ) then
    raise exception 'classroom academy mismatch';
  end if;

  return new;
end;
$$;

create trigger class_subject_classroom_assignments_validate
before insert or update of academy_id, class_id, subject_id, classroom_id
on public.class_subject_classroom_assignments
for each row execute function private.validate_class_subject_classroom_assignment();

alter table public.class_subject_classroom_assignments enable row level security;

revoke all on table public.class_subject_classroom_assignments from anon, authenticated;
grant select, insert, update on table public.class_subject_classroom_assignments to authenticated;

create policy class_subject_classroom_assignments_admin
on public.class_subject_classroom_assignments
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));

-- Preserve the current single-room behavior for existing classes whose active
-- students all use one classroom. Classes without enough information remain
-- unassigned and can be configured by an administrator in the class screen.
insert into public.class_subject_classroom_assignments (
  academy_id,
  class_id,
  subject_id,
  classroom_id
)
select
  class_rooms.academy_id,
  class_rooms.class_id,
  subject_ids.subject_id,
  class_rooms.classroom_id
from (
  select
    a.academy_id,
    a.class_id,
    (array_agg(s.classroom_id order by s.classroom_id))[1] as classroom_id
  from public.student_class_assignments a
  join public.students s on s.id = a.student_id
  join public.classes c on c.id = a.class_id and c.academy_id = a.academy_id and c.is_active
  where a.status = 'active'
    and s.classroom_id is not null
  group by a.academy_id, a.class_id
  having count(distinct s.classroom_id) = 1
) class_rooms
join public.academy_operation_settings settings on settings.academy_id = class_rooms.academy_id
cross join lateral (
  values (settings.grammar_subject_id), (settings.reading_subject_id)
) subject_ids(subject_id)
where subject_ids.subject_id is not null;
