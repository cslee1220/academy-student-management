-- Never allow academic cleanup to remove rows that are part of student history.
-- The API also blocks these requests, but this trigger protects direct SQL and
-- future server paths that might otherwise bypass the application guard.

create or replace function private.prevent_term_delete_with_student_history()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.student_class_assignments
    where academy_id = old.academy_id
      and term_id = old.id
  ) or exists (
    select 1
    from public.class_sessions
    where academy_id = old.academy_id
      and term_id = old.id
  ) or exists (
    select 1
    from public.exam_operations
    where academy_id = old.academy_id
      and term_id = old.id
  ) then
    raise exception 'term has student or class history and cannot be deleted'
      using errcode = '23514';
  end if;
  return old;
end;
$$;

drop trigger if exists terms_prevent_student_history_delete on public.terms;
create trigger terms_prevent_student_history_delete
before delete on public.terms
for each row execute function private.prevent_term_delete_with_student_history();

create or replace function private.prevent_school_year_delete_with_student_history()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.terms t
    join public.student_class_assignments a
      on a.academy_id = t.academy_id
     and a.term_id = t.id
    where t.academy_id = old.academy_id
      and t.school_year_id = old.id
  ) or exists (
    select 1
    from public.terms t
    join public.class_sessions cs
      on cs.academy_id = t.academy_id
     and cs.term_id = t.id
    where t.academy_id = old.academy_id
      and t.school_year_id = old.id
  ) or exists (
    select 1
    from public.terms t
    join public.exam_operations eo
      on eo.academy_id = t.academy_id
     and eo.term_id = t.id
    where t.academy_id = old.academy_id
      and t.school_year_id = old.id
  ) then
    raise exception 'school year has student or class history and cannot be deleted'
      using errcode = '23514';
  end if;
  return old;
end;
$$;

drop trigger if exists school_years_prevent_student_history_delete on public.school_years;
create trigger school_years_prevent_student_history_delete
before delete on public.school_years
for each row execute function private.prevent_school_year_delete_with_student_history();
