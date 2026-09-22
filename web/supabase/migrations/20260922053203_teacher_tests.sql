-- Teacher test definitions, per-student test results, and supplementary-study flag.
-- This migration intentionally contains no demo or personal data.

alter table public.teacher_subject_records
  add column is_supplementary boolean not null default false;

create table public.test_definitions (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  session_id uuid not null references public.class_sessions (id) on delete restrict,
  subject_id uuid not null references public.subjects (id) on delete restrict,
  teacher_id uuid not null references public.profiles (id) on delete restrict,
  sequence_no smallint not null check (sequence_no between 1 and 3),
  name text not null check (length(trim(name)) > 0),
  max_score numeric(6, 2) not null check (max_score > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, id),
  unique (academy_id, session_id, subject_id, teacher_id, sequence_no),
  foreign key (session_id, subject_id, teacher_id)
    references public.session_subject_assignments (session_id, subject_id, teacher_id)
    on delete restrict
);

create table public.student_test_results (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  test_definition_id uuid not null,
  score numeric(6, 2) check (score >= 0),
  non_attempt_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_id, student_id, test_definition_id),
  foreign key (academy_id, test_definition_id)
    references public.test_definitions (academy_id, id)
    on delete restrict,
  check (
    (score is not null and nullif(trim(non_attempt_reason), '') is null)
    or
    (score is null and nullif(trim(non_attempt_reason), '') is not null)
  )
);

create trigger test_definitions_set_updated_at before update on public.test_definitions
for each row execute function private.set_updated_at();
create trigger student_test_results_set_updated_at before update on public.student_test_results
for each row execute function private.set_updated_at();

alter table public.test_definitions enable row level security;
alter table public.student_test_results enable row level security;

revoke all on table public.test_definitions, public.student_test_results from anon, authenticated;
grant select, insert, update on table public.test_definitions, public.student_test_results to authenticated;

create policy test_definitions_access on public.test_definitions
for all to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    private.has_academy_role(academy_id, array['teacher']::text[])
    and teacher_id = private.current_profile_id()
    and private.teacher_has_subject_assignment(session_id, subject_id)
  )
)
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    private.has_academy_role(academy_id, array['teacher']::text[])
    and teacher_id = private.current_profile_id()
    and private.teacher_has_subject_assignment(session_id, subject_id)
  )
);

create policy student_test_results_select on public.student_test_results
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    private.has_academy_role(academy_id, array['teacher']::text[])
    and exists (
      select 1
      from public.test_definitions td
      where td.id = student_test_results.test_definition_id
        and td.academy_id = student_test_results.academy_id
        and td.teacher_id = private.current_profile_id()
        and private.teacher_has_subject_assignment(td.session_id, td.subject_id)
    )
    and exists (
      select 1
      from public.session_student_rosters ssr
      where ssr.academy_id = student_test_results.academy_id
        and ssr.session_id = (
          select td.session_id
          from public.test_definitions td
          where td.id = student_test_results.test_definition_id
        )
        and ssr.student_id = student_test_results.student_id
        and ssr.is_expected
    )
  )
);

create policy student_test_results_insert on public.student_test_results
for insert to authenticated
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    private.has_academy_role(academy_id, array['teacher']::text[])
    and exists (
      select 1
      from public.test_definitions td
      where td.id = student_test_results.test_definition_id
        and td.academy_id = student_test_results.academy_id
        and td.teacher_id = private.current_profile_id()
        and private.teacher_has_subject_assignment(td.session_id, td.subject_id)
    )
    and exists (
      select 1
      from public.session_student_rosters ssr
      where ssr.academy_id = student_test_results.academy_id
        and ssr.session_id = (
          select td.session_id
          from public.test_definitions td
          where td.id = student_test_results.test_definition_id
        )
        and ssr.student_id = student_test_results.student_id
        and ssr.is_expected
    )
  )
);

create policy student_test_results_update on public.student_test_results
for update to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    private.has_academy_role(academy_id, array['teacher']::text[])
    and exists (
      select 1
      from public.test_definitions td
      where td.id = student_test_results.test_definition_id
        and td.academy_id = student_test_results.academy_id
        and td.teacher_id = private.current_profile_id()
        and private.teacher_has_subject_assignment(td.session_id, td.subject_id)
    )
    and exists (
      select 1
      from public.session_student_rosters ssr
      where ssr.academy_id = student_test_results.academy_id
        and ssr.session_id = (
          select td.session_id
          from public.test_definitions td
          where td.id = student_test_results.test_definition_id
        )
        and ssr.student_id = student_test_results.student_id
        and ssr.is_expected
    )
  )
)
with check (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    private.has_academy_role(academy_id, array['teacher']::text[])
    and exists (
      select 1
      from public.test_definitions td
      where td.id = student_test_results.test_definition_id
        and td.academy_id = student_test_results.academy_id
        and td.teacher_id = private.current_profile_id()
        and private.teacher_has_subject_assignment(td.session_id, td.subject_id)
    )
    and exists (
      select 1
      from public.session_student_rosters ssr
      where ssr.academy_id = student_test_results.academy_id
        and ssr.session_id = (
          select td.session_id
          from public.test_definitions td
          where td.id = student_test_results.test_definition_id
        )
        and ssr.student_id = student_test_results.student_id
        and ssr.is_expected
    )
  )
);

create index test_definitions_academy_created_at_idx
  on public.test_definitions (academy_id, created_at);
create index test_definitions_session_subject_idx
  on public.test_definitions (academy_id, session_id, subject_id);
create index student_test_results_academy_created_at_idx
  on public.student_test_results (academy_id, created_at);
create index student_test_results_academy_student_idx
  on public.student_test_results (academy_id, student_id, test_definition_id);
