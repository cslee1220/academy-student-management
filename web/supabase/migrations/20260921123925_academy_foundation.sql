-- Academy PWA core data and authorization foundation.
-- This migration intentionally contains no demo or personal data.

create extension if not exists pgcrypto;

create schema if not exists private;

create table public.academies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null check (status in ('active', 'inactive')),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete restrict,
  display_name text not null,
  phone text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.academy_memberships (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  profile_id uuid not null references public.profiles (id) on delete restrict,
  role text not null check (role in ('system_admin', 'academy_admin', 'teacher')),
  is_active boolean not null default true,
  activated_at timestamptz,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, profile_id)
);

create table public.school_years (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  name text not null,
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, name),
  check (start_date <= end_date)
);

create table public.terms (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  school_year_id uuid not null references public.school_years (id) on delete restrict,
  name text not null,
  start_date date not null,
  end_date date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, school_year_id, name),
  check (start_date <= end_date)
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  name text not null,
  category text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, name)
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, name)
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  student_no text not null,
  name text not null,
  school_name text,
  grade text,
  registered_at date not null,
  level text,
  phone text,
  current_status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, student_no)
);

create table public.student_class_assignments (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  class_id uuid not null references public.classes (id) on delete restrict,
  term_id uuid not null references public.terms (id) on delete restrict,
  start_date date not null,
  end_date date,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, class_id, term_id, start_date),
  check (end_date is null or start_date <= end_date)
);

create table public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  class_id uuid not null references public.classes (id) on delete restrict,
  term_id uuid not null references public.terms (id) on delete restrict,
  session_date date not null,
  start_time time not null,
  end_time time not null,
  status text not null,
  lead_teacher_id uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, class_id, session_date, start_time),
  check (start_time < end_time)
);

create table public.session_subject_assignments (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  session_id uuid not null references public.class_sessions (id) on delete restrict,
  subject_id uuid not null references public.subjects (id) on delete restrict,
  teacher_id uuid not null references public.profiles (id) on delete restrict,
  subject_name_snapshot text not null,
  teacher_name_snapshot text not null,
  expected_status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, subject_id, teacher_id)
);

create table public.session_student_rosters (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  session_id uuid not null references public.class_sessions (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  class_assignment_id uuid references public.student_class_assignments (id) on delete restrict,
  class_name_snapshot text not null,
  is_expected boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, student_id)
);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  session_id uuid not null references public.class_sessions (id) on delete restrict,
  attendance_status text not null check (attendance_status in ('present', 'absent', 'unexcused_absent')),
  absence_note text,
  final_saved_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, student_id, session_id)
);

create table public.common_homework (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  class_id uuid not null references public.classes (id) on delete restrict,
  session_id uuid not null references public.class_sessions (id) on delete restrict,
  content text,
  no_homework boolean not null default false,
  final_saved_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, class_id, session_id)
);

create table public.teacher_subject_records (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  session_id uuid not null references public.class_sessions (id) on delete restrict,
  subject_id uuid not null references public.subjects (id) on delete restrict,
  teacher_id uuid not null references public.profiles (id) on delete restrict,
  homework_score smallint check (homework_score between 1 and 5),
  understanding_score smallint check (understanding_score between 1 and 5),
  participation_score smallint check (participation_score between 1 and 5),
  remedial_type text,
  remedial_note text,
  personal_homework text,
  public_note text,
  status text not null check (status in ('draft', 'final')),
  first_final_saved_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, student_id, session_id, subject_id, teacher_id)
);

create table public.guardians (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  auth_user_id uuid unique references auth.users (id) on delete restrict,
  display_name text not null,
  phone text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.student_guardians (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  guardian_id uuid not null references public.guardians (id) on delete restrict,
  relationship text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, student_id, guardian_id)
);

create table public.publication_bundles (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  session_id uuid not null references public.class_sessions (id) on delete restrict,
  status text not null check (status in ('drafting', 'ready', 'published')),
  approved_by_profile_id uuid references public.profiles (id) on delete restrict,
  approved_at timestamptz,
  corrected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, student_id, session_id)
);

create table public.publication_snapshots (
  id uuid primary key default gen_random_uuid(),
  publication_bundle_id uuid not null references public.publication_bundles (id) on delete restrict,
  item_key text not null,
  is_visible boolean not null default false,
  label_snapshot text not null,
  created_at timestamptz not null default now(),
  unique (publication_bundle_id, item_key)
);

create table public.change_requests (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  requested_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  target_table text not null,
  target_id uuid not null,
  field_key text not null,
  requested_value_json jsonb not null,
  reason text not null,
  status text not null check (status in ('pending', 'approved', 'rejected')),
  reviewed_by_profile_id uuid references public.profiles (id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  target_table text not null,
  target_id uuid not null,
  field_key text,
  old_value_json jsonb,
  new_value_json jsonb,
  reason text not null,
  actor_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.private_records (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  record_type text not null check (record_type in ('consultation', 'risk_note', 'handover')),
  content text not null,
  author_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.parent_consultations (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  guardian_id uuid references public.guardians (id) on delete restrict,
  consultation_at timestamptz,
  teacher_id uuid references public.profiles (id) on delete restrict,
  method text,
  status text,
  content text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function private.set_updated_at();
create trigger academy_memberships_set_updated_at before update on public.academy_memberships
for each row execute function private.set_updated_at();
create trigger school_years_set_updated_at before update on public.school_years
for each row execute function private.set_updated_at();
create trigger terms_set_updated_at before update on public.terms
for each row execute function private.set_updated_at();
create trigger classes_set_updated_at before update on public.classes
for each row execute function private.set_updated_at();
create trigger subjects_set_updated_at before update on public.subjects
for each row execute function private.set_updated_at();
create trigger students_set_updated_at before update on public.students
for each row execute function private.set_updated_at();
create trigger student_class_assignments_set_updated_at before update on public.student_class_assignments
for each row execute function private.set_updated_at();
create trigger class_sessions_set_updated_at before update on public.class_sessions
for each row execute function private.set_updated_at();
create trigger session_subject_assignments_set_updated_at before update on public.session_subject_assignments
for each row execute function private.set_updated_at();
create trigger session_student_rosters_set_updated_at before update on public.session_student_rosters
for each row execute function private.set_updated_at();
create trigger attendance_records_set_updated_at before update on public.attendance_records
for each row execute function private.set_updated_at();
create trigger common_homework_set_updated_at before update on public.common_homework
for each row execute function private.set_updated_at();
create trigger teacher_subject_records_set_updated_at before update on public.teacher_subject_records
for each row execute function private.set_updated_at();
create trigger guardians_set_updated_at before update on public.guardians
for each row execute function private.set_updated_at();
create trigger student_guardians_set_updated_at before update on public.student_guardians
for each row execute function private.set_updated_at();
create trigger publication_bundles_set_updated_at before update on public.publication_bundles
for each row execute function private.set_updated_at();
create trigger change_requests_set_updated_at before update on public.change_requests
for each row execute function private.set_updated_at();
create trigger parent_consultations_set_updated_at before update on public.parent_consultations
for each row execute function private.set_updated_at();

create or replace function private.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id
  from public.profiles p
  where p.auth_user_id = (select auth.uid())
  limit 1
$$;

create or replace function private.has_academy_role(p_academy_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.academy_memberships am
    join public.profiles p on p.id = am.profile_id
    where p.auth_user_id = (select auth.uid())
      and am.academy_id = p_academy_id
      and am.is_active
      and am.role = any (p_roles)
  )
$$;

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
  )
$$;

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
  )
$$;

create or replace function private.teacher_has_term(p_term_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.class_sessions cs
    where cs.term_id = p_term_id
      and private.teacher_has_session(cs.id)
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
    where ssr.academy_id = p_academy_id
      and ssr.student_id = p_student_id
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
    where sg.academy_id = p_academy_id
      and sg.student_id = p_student_id
      and sg.is_active
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
    where pb.id = p_bundle_id
      and pb.status = 'published'
      and private.guardian_can_view_student(pb.academy_id, pb.student_id)
  )
$$;

alter table public.academies enable row level security;
alter table public.profiles enable row level security;
alter table public.academy_memberships enable row level security;
alter table public.school_years enable row level security;
alter table public.terms enable row level security;
alter table public.classes enable row level security;
alter table public.subjects enable row level security;
alter table public.students enable row level security;
alter table public.student_class_assignments enable row level security;
alter table public.class_sessions enable row level security;
alter table public.session_subject_assignments enable row level security;
alter table public.session_student_rosters enable row level security;
alter table public.attendance_records enable row level security;
alter table public.common_homework enable row level security;
alter table public.teacher_subject_records enable row level security;
alter table public.guardians enable row level security;
alter table public.student_guardians enable row level security;
alter table public.publication_bundles enable row level security;
alter table public.publication_snapshots enable row level security;
alter table public.change_requests enable row level security;
alter table public.audit_logs enable row level security;
alter table public.private_records enable row level security;
alter table public.parent_consultations enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update on all tables in schema public to authenticated;
revoke all on schema private from public;
grant usage on schema private to authenticated;
revoke all on all functions in schema private from public;
grant execute on function private.current_profile_id() to authenticated;
grant execute on function private.has_academy_role(uuid, text[]) to authenticated;
grant execute on function private.teacher_has_session(uuid) to authenticated;
grant execute on function private.teacher_is_lead_for_session(uuid) to authenticated;
grant execute on function private.teacher_has_class(uuid) to authenticated;
grant execute on function private.teacher_has_subject(uuid) to authenticated;
grant execute on function private.teacher_has_term(uuid) to authenticated;
grant execute on function private.teacher_can_access_student(uuid, uuid) to authenticated;
grant execute on function private.teacher_has_subject_assignment(uuid, uuid) to authenticated;
grant execute on function private.guardian_can_view_student(uuid, uuid) to authenticated;
grant execute on function private.guardian_can_view_bundle(uuid) to authenticated;

create policy academies_select on public.academies
for select to authenticated
using (private.has_academy_role(id, array['academy_admin', 'teacher']::text[]));

create policy academies_update on public.academies
for update to authenticated
using (private.has_academy_role(id, array['academy_admin']::text[]))
with check (private.has_academy_role(id, array['academy_admin']::text[]));

create policy profiles_select on public.profiles
for select to authenticated
using (
  id = private.current_profile_id()
  or exists (
    select 1
    from public.academy_memberships am
    where am.profile_id = profiles.id
      and private.has_academy_role(am.academy_id, array['academy_admin']::text[])
  )
);

create policy profiles_insert on public.profiles
for insert to authenticated
with check (auth_user_id = (select auth.uid()));

create policy profiles_update on public.profiles
for update to authenticated
using (id = private.current_profile_id())
with check (auth_user_id = (select auth.uid()));

create policy memberships_select on public.academy_memberships
for select to authenticated
using (
  profile_id = private.current_profile_id()
  or private.has_academy_role(academy_id, array['academy_admin']::text[])
);

create policy memberships_insert on public.academy_memberships
for insert to authenticated
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  and role in ('academy_admin', 'teacher')
);

create policy memberships_update on public.academy_memberships
for update to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  and role in ('academy_admin', 'teacher')
);

create policy school_years_select on public.school_years
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_has_term(id)
);

create policy school_years_manage on public.school_years
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));

create policy terms_select on public.terms
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_has_term(id)
);

create policy terms_manage on public.terms
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));

create policy classes_select on public.classes
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_has_class(id)
);

create policy classes_manage on public.classes
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));

create policy subjects_select on public.subjects
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_has_subject(id)
);

create policy subjects_manage on public.subjects
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));

create policy students_select on public.students
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_access_student(academy_id, id)
);

create policy students_manage on public.students
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));

create policy assignments_select on public.student_class_assignments
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_has_class(class_id)
);

create policy assignments_manage on public.student_class_assignments
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));

create policy sessions_select on public.class_sessions
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_has_session(id)
);

create policy sessions_manage on public.class_sessions
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));

create policy session_subjects_select on public.session_subject_assignments
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or teacher_id = private.current_profile_id()
);

create policy session_subjects_manage on public.session_subject_assignments
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));

create policy roster_select on public.session_student_rosters
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_has_session(session_id)
);

create policy roster_manage on public.session_student_rosters
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));

create policy attendance_select on public.attendance_records
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_is_lead_for_session(session_id)
);

create policy attendance_insert on public.attendance_records
for insert to authenticated
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_is_lead_for_session(session_id)
);

create policy attendance_update on public.attendance_records
for update to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_is_lead_for_session(session_id)
)
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_is_lead_for_session(session_id)
);

create policy homework_select on public.common_homework
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_is_lead_for_session(session_id)
);

create policy homework_insert on public.common_homework
for insert to authenticated
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_is_lead_for_session(session_id)
);

create policy homework_update on public.common_homework
for update to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_is_lead_for_session(session_id)
)
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_is_lead_for_session(session_id)
);

create policy subject_records_select on public.teacher_subject_records
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    teacher_id = private.current_profile_id()
    and private.teacher_has_subject_assignment(session_id, subject_id)
    and private.teacher_can_access_student(academy_id, student_id)
  )
);

create policy subject_records_insert on public.teacher_subject_records
for insert to authenticated
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    teacher_id = private.current_profile_id()
    and private.teacher_has_subject_assignment(session_id, subject_id)
    and private.teacher_can_access_student(academy_id, student_id)
  )
);

create policy subject_records_update on public.teacher_subject_records
for update to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    teacher_id = private.current_profile_id()
    and private.teacher_has_subject_assignment(session_id, subject_id)
    and private.teacher_can_access_student(academy_id, student_id)
  )
)
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    teacher_id = private.current_profile_id()
    and private.teacher_has_subject_assignment(session_id, subject_id)
    and private.teacher_can_access_student(academy_id, student_id)
  )
);

create policy guardians_select on public.guardians
for select to authenticated
using (
  auth_user_id = (select auth.uid())
  or private.has_academy_role(academy_id, array['academy_admin']::text[])
);

create policy guardians_manage on public.guardians
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));

create policy student_guardians_select on public.student_guardians
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.guardian_can_view_student(academy_id, student_id)
);

create policy student_guardians_manage on public.student_guardians
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));

create policy publication_bundles_select on public.publication_bundles
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.guardian_can_view_student(academy_id, student_id)
);

create policy publication_bundles_manage on public.publication_bundles
for all to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));

create policy publication_snapshots_select on public.publication_snapshots
for select to authenticated
using (
  private.guardian_can_view_bundle(publication_bundle_id)
  or exists (
    select 1
    from public.publication_bundles pb
    where pb.id = publication_snapshots.publication_bundle_id
      and private.has_academy_role(pb.academy_id, array['academy_admin']::text[])
  )
);

create policy publication_snapshots_manage on public.publication_snapshots
for all to authenticated
using (
  exists (
    select 1
    from public.publication_bundles pb
    where pb.id = publication_snapshots.publication_bundle_id
      and private.has_academy_role(pb.academy_id, array['academy_admin']::text[])
  )
)
with check (
  exists (
    select 1
    from public.publication_bundles pb
    where pb.id = publication_snapshots.publication_bundle_id
      and private.has_academy_role(pb.academy_id, array['academy_admin']::text[])
  )
);

create policy change_requests_select on public.change_requests
for select to authenticated
using (
  requested_by_profile_id = private.current_profile_id()
  or private.has_academy_role(academy_id, array['academy_admin']::text[])
);

create policy change_requests_insert on public.change_requests
for insert to authenticated
with check (
  requested_by_profile_id = private.current_profile_id()
  and private.has_academy_role(academy_id, array['academy_admin', 'teacher']::text[])
);

create policy change_requests_update on public.change_requests
for update to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (private.has_academy_role(academy_id, array['academy_admin']::text[]));

create policy audit_logs_select on public.audit_logs
for select to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]));

create policy audit_logs_insert on public.audit_logs
for insert to authenticated
with check (
  actor_profile_id = private.current_profile_id()
  and private.has_academy_role(academy_id, array['academy_admin']::text[])
);

create policy private_records_select on public.private_records
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or private.teacher_can_access_student(academy_id, student_id)
);

create policy private_records_insert on public.private_records
for insert to authenticated
with check (
  author_profile_id = private.current_profile_id()
  and private.has_academy_role(academy_id, array['academy_admin', 'teacher']::text[])
  and (
    private.has_academy_role(academy_id, array['academy_admin']::text[])
    or private.teacher_can_access_student(academy_id, student_id)
  )
);

create policy consultations_select on public.parent_consultations
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    teacher_id = private.current_profile_id()
    and private.teacher_can_access_student(academy_id, student_id)
  )
);

create policy consultations_insert on public.parent_consultations
for insert to authenticated
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    teacher_id = private.current_profile_id()
    and private.teacher_can_access_student(academy_id, student_id)
  )
);

create policy consultations_update on public.parent_consultations
for update to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    teacher_id = private.current_profile_id()
    and private.teacher_can_access_student(academy_id, student_id)
  )
)
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    teacher_id = private.current_profile_id()
    and private.teacher_can_access_student(academy_id, student_id)
  )
);

create index school_years_academy_created_at_idx on public.school_years (academy_id, created_at);
create index terms_academy_created_at_idx on public.terms (academy_id, created_at);
create index classes_academy_created_at_idx on public.classes (academy_id, created_at);
create index subjects_academy_created_at_idx on public.subjects (academy_id, created_at);
create index students_academy_created_at_idx on public.students (academy_id, created_at);
create index students_academy_status_registered_idx on public.students (academy_id, current_status, registered_at);
create index assignments_academy_created_at_idx on public.student_class_assignments (academy_id, created_at);
create index assignments_academy_class_term_start_idx on public.student_class_assignments (academy_id, class_id, term_id, start_date);
create index sessions_academy_created_at_idx on public.class_sessions (academy_id, created_at);
create index sessions_academy_class_date_idx on public.class_sessions (academy_id, class_id, session_date);
create index session_subjects_academy_created_at_idx on public.session_subject_assignments (academy_id, created_at);
create index roster_academy_created_at_idx on public.session_student_rosters (academy_id, created_at);
create index attendance_academy_created_at_idx on public.attendance_records (academy_id, created_at);
create index attendance_academy_student_session_idx on public.attendance_records (academy_id, student_id, session_id);
create index homework_academy_created_at_idx on public.common_homework (academy_id, created_at);
create index subject_records_academy_created_at_idx on public.teacher_subject_records (academy_id, created_at);
create index subject_records_academy_student_session_idx on public.teacher_subject_records (academy_id, student_id, session_id);
create index guardians_academy_created_at_idx on public.guardians (academy_id, created_at);
create index student_guardians_academy_created_at_idx on public.student_guardians (academy_id, created_at);
create index publication_bundles_academy_created_at_idx on public.publication_bundles (academy_id, created_at);
create index change_requests_academy_created_at_idx on public.change_requests (academy_id, created_at);
create index audit_logs_academy_created_at_idx on public.audit_logs (academy_id, created_at);
create index private_records_academy_created_at_idx on public.private_records (academy_id, created_at);
create index consultations_academy_created_at_idx on public.parent_consultations (academy_id, created_at);
