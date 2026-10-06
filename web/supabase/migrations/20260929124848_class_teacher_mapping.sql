-- A class can override the academy-wide defaults with its own grammar/reading teachers.
-- Existing classes keep both values null and continue to use academy_operation_settings.
alter table public.classes
  add column grammar_teacher_id uuid references public.profiles (id) on delete restrict,
  add column reading_teacher_id uuid references public.profiles (id) on delete restrict,
  add constraint classes_teacher_mapping_complete
    check (
      (grammar_teacher_id is null and reading_teacher_id is null)
      or (grammar_teacher_id is not null and reading_teacher_id is not null)
    );

create index classes_teacher_mapping_idx
  on public.classes (academy_id, grammar_teacher_id, reading_teacher_id);

create or replace function private.validate_class_teacher_mapping()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.grammar_teacher_id is null and new.reading_teacher_id is null then
    return new;
  end if;

  if new.grammar_teacher_id = new.reading_teacher_id then
    raise exception 'class grammar and reading teachers must be different' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.academy_memberships am
    where am.academy_id = new.academy_id
      and am.profile_id = new.grammar_teacher_id
      and am.role = 'teacher'
      and am.is_active
  ) or not exists (
    select 1
    from public.academy_memberships am
    where am.academy_id = new.academy_id
      and am.profile_id = new.reading_teacher_id
      and am.role = 'teacher'
      and am.is_active
  ) then
    raise exception 'class teachers must be active academy teachers' using errcode = '23503';
  end if;

  return new;
end;
$$;

create trigger classes_validate_teacher_mapping
before insert or update of academy_id, grammar_teacher_id, reading_teacher_id
on public.classes
for each row execute function private.validate_class_teacher_mapping();

-- New students choose their classroom at registration. Keep legacy defaults nullable
-- so existing operation settings and historical students remain usable.
alter table public.academy_operation_settings
  alter column grammar_classroom_id drop not null,
  alter column reading_classroom_id drop not null;
