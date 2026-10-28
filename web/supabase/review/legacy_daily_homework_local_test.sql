-- REVIEW-ONLY LOCAL POSTGRESQL 17 FIXTURE
-- Run only in a disposable local PostgreSQL container.
-- This script uses synthetic UUIDs and contains no application or personal data.
-- It intentionally models the homework branch, RLS boundaries, and triggers.
-- It does not connect to Supabase Auth or the remote project.

\set ON_ERROR_STOP on

drop schema if exists legacy_test cascade;
drop role if exists legacy_test_teacher;
drop role if exists legacy_test_other_teacher;
drop role if exists legacy_test_guardian;

create role legacy_test_teacher nologin;
create role legacy_test_other_teacher nologin;
create role legacy_test_guardian nologin;

-- The local fixture runs as postgres and uses SET ROLE to exercise RLS.
grant legacy_test_teacher, legacy_test_other_teacher, legacy_test_guardian to postgres;

begin;

create schema legacy_test;
create extension if not exists pgcrypto;

create table legacy_test.academies (
  id uuid primary key
);

create table legacy_test.classes (
  id uuid primary key,
  academy_id uuid not null references legacy_test.academies(id)
);

create table legacy_test.subjects (
  id uuid primary key,
  academy_id uuid not null references legacy_test.academies(id)
);

create table legacy_test.teacher_class_access (
  role_name name not null,
  academy_id uuid not null,
  class_id uuid not null,
  record_date date not null,
  primary key (role_name, academy_id, class_id, record_date)
);

create table legacy_test.guardian_homework_access (
  role_name name not null,
  academy_id uuid not null,
  class_id uuid not null,
  record_date date not null,
  primary key (role_name, academy_id, class_id, record_date)
);

create table legacy_test.daily_common_homework (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references legacy_test.academies(id) on delete restrict,
  class_id uuid not null references legacy_test.classes(id) on delete restrict,
  record_date date not null,
  content text,
  no_homework boolean not null default false,
  version integer not null default 1 check (version > 0),
  save_state text not null default 'draft' check (save_state in ('draft', 'final')),
  operation_group text not null default 'common' check (operation_group in ('A', 'B', 'common')),
  subject_id uuid references legacy_test.subjects(id) on delete restrict,
  unique (academy_id, class_id, record_date, subject_id, operation_group)
);

create or replace function legacy_test.validate_daily_homework_class()
returns trigger
language plpgsql
set search_path = legacy_test, pg_temp
as $$
begin
  if not exists (
    select 1
    from legacy_test.classes c
    where c.id = new.class_id
      and c.academy_id = new.academy_id
  ) then
    raise exception 'class does not belong to academy';
  end if;
  return new;
end;
$$;

create trigger daily_common_homework_validate_class
before insert or update of academy_id, class_id
on legacy_test.daily_common_homework
for each row execute function legacy_test.validate_daily_homework_class();

create or replace function legacy_test.set_updated_at()
returns trigger
language plpgsql
set search_path = legacy_test, pg_temp
as $$
begin
  return new;
end;
$$;

create trigger daily_common_homework_set_updated_at
before update on legacy_test.daily_common_homework
for each row execute function legacy_test.set_updated_at();

create or replace function legacy_test.save_legacy_common_homework(
  p_academy_id uuid,
  p_class_id uuid,
  p_record_date date,
  p_save_mode text,
  p_content text,
  p_no_homework boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = legacy_test, pg_temp
as $$
declare
  v_homework_id uuid;
  v_homework_version integer;
begin
  if p_save_mode not in ('draft', 'final') then
    raise exception 'invalid save mode';
  end if;

  perform 1
  from legacy_test.classes
  where id = p_class_id and academy_id = p_academy_id
  for update;

  select id, version
  into v_homework_id, v_homework_version
  from legacy_test.daily_common_homework
  where academy_id = p_academy_id
    and class_id = p_class_id
    and record_date = p_record_date
    and subject_id is null
    and operation_group = 'common'
  order by id
  limit 1
  for update;

  if exists (
    select 1
    from legacy_test.daily_common_homework duplicate
    where duplicate.academy_id = p_academy_id
      and duplicate.class_id = p_class_id
      and duplicate.record_date = p_record_date
      and duplicate.subject_id is null
      and duplicate.operation_group = 'common'
      and (v_homework_id is null or duplicate.id <> v_homework_id)
  ) then
    raise exception 'ambiguous legacy common homework rows exist';
  end if;

  if v_homework_id is null then
    insert into legacy_test.daily_common_homework (
      academy_id, class_id, record_date, subject_id, operation_group,
      content, no_homework, save_state, version
    ) values (
      p_academy_id, p_class_id, p_record_date, null, 'common',
      p_content, p_no_homework, p_save_mode, 1
    )
    returning id into v_homework_id;
  else
    update legacy_test.daily_common_homework
    set content = p_content,
        no_homework = p_no_homework,
        save_state = p_save_mode,
        version = v_homework_version + 1
    where id = v_homework_id;
  end if;

  return v_homework_id;
end;
$$;

create or replace function legacy_test.save_subject_homework(
  p_academy_id uuid,
  p_class_id uuid,
  p_subject_id uuid,
  p_record_date date,
  p_operation_group text,
  p_content text
)
returns uuid
language plpgsql
security invoker
set search_path = legacy_test, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into legacy_test.daily_common_homework (
    academy_id, class_id, subject_id, record_date, operation_group,
    content, save_state, version
  ) values (
    p_academy_id, p_class_id, p_subject_id, p_record_date, p_operation_group,
    p_content, 'final', 1
  )
  on conflict (academy_id, class_id, record_date, subject_id, operation_group)
  do update set content = excluded.content,
                version = legacy_test.daily_common_homework.version + 1
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function legacy_test.assert_true(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if not p_condition then
    raise exception 'ASSERTION FAILED: %', p_message;
  end if;
end;
$$;

insert into legacy_test.academies values
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002');

insert into legacy_test.classes values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002');

insert into legacy_test.subjects values
  ('30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001');

insert into legacy_test.teacher_class_access
select
  'legacy_test_teacher',
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  date '2026-01-15' + offset_value
from generate_series(0, 4) as offsets(offset_value);

insert into legacy_test.guardian_homework_access values
  ('legacy_test_guardian', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', date '2026-01-15');

alter table legacy_test.daily_common_homework enable row level security;

create policy teacher_homework_write
on legacy_test.daily_common_homework
for all to legacy_test_teacher
using (exists (
  select 1 from legacy_test.teacher_class_access a
  where a.role_name = current_user
    and a.academy_id = daily_common_homework.academy_id
    and a.class_id = daily_common_homework.class_id
    and a.record_date = daily_common_homework.record_date
))
with check (exists (
  select 1 from legacy_test.teacher_class_access a
  where a.role_name = current_user
    and a.academy_id = daily_common_homework.academy_id
    and a.class_id = daily_common_homework.class_id
    and a.record_date = daily_common_homework.record_date
));

create policy guardian_homework_read
on legacy_test.daily_common_homework
for select to legacy_test_guardian
using (
  save_state = 'final'
  and exists (
    select 1 from legacy_test.guardian_homework_access a
    where a.role_name = current_user
      and a.academy_id = daily_common_homework.academy_id
      and a.class_id = daily_common_homework.class_id
      and a.record_date = daily_common_homework.record_date
  )
);

grant usage on schema legacy_test to legacy_test_teacher, legacy_test_other_teacher, legacy_test_guardian;
grant select, update on legacy_test.classes to legacy_test_teacher;
grant select on legacy_test.teacher_class_access, legacy_test.guardian_homework_access to legacy_test_teacher;
grant select on legacy_test.guardian_homework_access to legacy_test_guardian;
grant select, insert, update on legacy_test.daily_common_homework to legacy_test_teacher;
grant select on legacy_test.daily_common_homework to legacy_test_other_teacher, legacy_test_guardian;
grant execute on function legacy_test.save_legacy_common_homework(uuid, uuid, date, text, text, boolean) to legacy_test_teacher;
grant execute on function legacy_test.save_subject_homework(uuid, uuid, uuid, date, text, text) to legacy_test_teacher;

set role legacy_test_teacher;

-- 1. 신규 legacy 공통숙제: operation_group 기본값과 명시적 common이 보존된다.
select legacy_test.save_legacy_common_homework(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  date '2026-01-15',
  'draft',
  'synthetic common homework',
  false
);
select legacy_test.assert_true(
  (select count(*) = 1 and bool_and(subject_id is null and operation_group = 'common')
   from legacy_test.daily_common_homework),
  'new legacy row must be subjectless/common'
);

-- 2. 동일 legacy 요청 반복: 행 수는 늘지 않고 version만 증가한다.
select legacy_test.save_legacy_common_homework(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  date '2026-01-15',
  'draft',
  'synthetic common homework updated',
  false
);
select legacy_test.assert_true(
  (select count(*) = 1 and max(version) = 2 from legacy_test.daily_common_homework),
  'repeated legacy save must update one row'
);

-- 3. subject-scoped 저장: 서로 다른 과목은 별도 행이어야 한다.
select legacy_test.save_subject_homework(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  date '2026-01-15', 'A', 'subject one'
);
select legacy_test.save_subject_homework(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002',
  date '2026-01-15', 'A', 'subject two'
);
select legacy_test.assert_true(
  (select count(*) = 3
   and count(*) filter (where subject_id = '30000000-0000-4000-8000-000000000001') = 1
   and count(*) filter (where subject_id = '30000000-0000-4000-8000-000000000002') = 1
   from legacy_test.daily_common_homework),
  'different subjects must remain separate'
);

-- 4. 동일 과목·운영그룹 반복: 기존 subject row만 갱신한다.
select legacy_test.save_subject_homework(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  date '2026-01-15', 'A', 'subject one updated'
);
select legacy_test.assert_true(
  (select count(*) = 3
   and count(*) filter (where content = 'subject one updated') = 1
   from legacy_test.daily_common_homework),
  'same subject/group must be idempotent'
);

-- 5. 기존 legacy row 보존: subjectless/common 행을 직접 만들고 함수가 갱신한다.
reset role;
insert into legacy_test.daily_common_homework (
  academy_id, class_id, record_date, subject_id, content, save_state
) values (
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  date '2026-01-16', null, 'old legacy', 'final'
);
set role legacy_test_teacher;
select legacy_test.save_legacy_common_homework(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  date '2026-01-16', 'final', 'old legacy updated', false
);
select legacy_test.assert_true(
  (select count(*) = 4
   and count(*) filter (where record_date = date '2026-01-16' and content = 'old legacy updated' and operation_group = 'common') = 1
   from legacy_test.daily_common_homework),
  'existing legacy row must be updated, not duplicated'
);

-- 6. subject_id NULL + A/B 행은 legacy common 함수의 대상이 아니다.
reset role;
insert into legacy_test.daily_common_homework (
  academy_id, class_id, record_date, subject_id, operation_group, content, save_state
) values (
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  date '2026-01-17', null, 'A', 'legacy grouped row', 'final'
);
set role legacy_test_teacher;
select legacy_test.save_legacy_common_homework(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  date '2026-01-17', 'final', 'new common', false
);
select legacy_test.assert_true(
  (select count(*) = 6
   and count(*) filter (where record_date = date '2026-01-17' and operation_group = 'A' and content = 'legacy grouped row') = 1
   and count(*) filter (where record_date = date '2026-01-17' and operation_group = 'common' and content = 'new common') = 1
   from legacy_test.daily_common_homework),
  'subjectless A/B legacy rows must be preserved and not overwritten'
);

-- 7. 다른 학원 접근 차단: RLS check failure and no row creation.
do $$
begin
  begin
    perform legacy_test.save_legacy_common_homework(
      '00000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000001',
      date '2026-01-15', 'draft', 'cross academy attempt', false
    );
    raise exception 'cross-academy write unexpectedly succeeded';
  exception when others then
    null;
  end;
end;
$$;
select legacy_test.assert_true(
  (select count(*) = 0 from legacy_test.daily_common_homework where academy_id = '00000000-0000-4000-8000-000000000002'),
  'cross-academy write must create no row'
);

-- 8. 잘못된 입력 rollback: 함수 실패와 함께 저장된 marker도 사라져야 한다.
create temp table rollback_marker(value text) on commit drop;
do $$
begin
  begin
    insert into rollback_marker values ('must rollback');
    perform legacy_test.save_legacy_common_homework(
      '00000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      date '2026-01-18', 'invalid', 'bad input', false
    );
  exception when others then
    null;
  end;
end;
$$;
select legacy_test.assert_true(
  (select count(*) = 0 from rollback_marker),
  'invalid save mode must roll back the marker'
);

reset role;

-- 9. 다른 교사는 행을 볼 수 없고, 보호자는 final만 볼 수 있다.
set role legacy_test_other_teacher;
select legacy_test.assert_true(
  (select count(*) = 0 from legacy_test.daily_common_homework),
  'unassigned teacher must not read homework'
);
reset role;

set role legacy_test_guardian;
select legacy_test.assert_true(
  (select count(*) = 2
   from legacy_test.daily_common_homework
   where save_state = 'final'),
  'guardian must read only final rows in the permitted class/date'
);
reset role;

-- 10. trigger cross-academy 보호.
do $$
begin
  begin
    insert into legacy_test.daily_common_homework (
      academy_id, class_id, record_date, content
    ) values (
      '00000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      date '2026-01-19', 'invalid class/academy'
    );
    raise exception 'cross-academy class insert unexpectedly succeeded';
  exception when others then
    null;
  end;
end;
$$;

select 'LEGACY_DAILY_HOMEWORK_LOCAL_TEST_PASS' as result;

rollback;
