begin;

-- One academy-wide lesson-record form. Item ids live inside the JSON document
-- so labels/order can change without changing the identity used by records.
create table if not exists public.academy_lesson_record_settings (
  academy_id uuid primary key references public.academies(id) on delete restrict,
  tests_enabled boolean not null default true,
  student_memo_enabled boolean not null default true,
  common_record_enabled boolean not null default true,
  metrics jsonb not null default '[]'::jsonb,
  supplement_types jsonb not null default '[]'::jsonb,
  version integer not null default 1 check (version > 0),
  updated_by_profile_id uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(metrics) = 'array'),
  check (jsonb_typeof(supplement_types) = 'array')
);

alter table public.academy_setting_history
  drop constraint if exists academy_setting_history_setting_key_check;

alter table public.academy_setting_history
  add constraint academy_setting_history_setting_key_check check (
    setting_key in (
      'guardian_publication.homework_score',
      'guardian_publication.understanding_score',
      'guardian_publication.participation_score',
      'lesson_record.form'
    )
  );

alter table public.daily_subject_records
  add column if not exists record_form_snapshot jsonb,
  add column if not exists metric_values jsonb not null default '{}'::jsonb,
  add column if not exists supplement_items jsonb not null default '[]'::jsonb;

alter table public.student_supplement_tasks
  add column if not exists supplement_items jsonb not null default '[]'::jsonb;

create index if not exists daily_subject_records_form_snapshot_idx
  on public.daily_subject_records (academy_id, record_date);

alter table public.academy_lesson_record_settings enable row level security;
revoke all on table public.academy_lesson_record_settings from anon, authenticated;
grant select, insert, update on table public.academy_lesson_record_settings to authenticated;

drop policy if exists academy_lesson_record_settings_select on public.academy_lesson_record_settings;
create policy academy_lesson_record_settings_select on public.academy_lesson_record_settings
for select to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]));

drop policy if exists academy_lesson_record_settings_insert on public.academy_lesson_record_settings;
create policy academy_lesson_record_settings_insert on public.academy_lesson_record_settings
for insert to authenticated
with check (
  updated_by_profile_id = private.current_profile_id()
  and private.has_academy_role(academy_id, array['academy_admin']::text[])
);

drop policy if exists academy_lesson_record_settings_update on public.academy_lesson_record_settings;
create policy academy_lesson_record_settings_update on public.academy_lesson_record_settings
for update to authenticated
using (private.has_academy_role(academy_id, array['academy_admin']::text[]))
with check (
  updated_by_profile_id = private.current_profile_id()
  and private.has_academy_role(academy_id, array['academy_admin']::text[])
);

drop trigger if exists academy_lesson_record_settings_set_updated_at on public.academy_lesson_record_settings;
create trigger academy_lesson_record_settings_set_updated_at
before update on public.academy_lesson_record_settings
for each row execute function private.set_updated_at();

create or replace function private.lesson_record_default_metrics()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_array(
    jsonb_build_object('id', '00000000-0000-4000-8000-000000000001', 'code', 'homework', 'name', '숙제', 'displayOrder', 1, 'isActive', true, 'scaleMax', 5),
    jsonb_build_object('id', '00000000-0000-4000-8000-000000000002', 'code', 'understanding', 'name', '이해도', 'displayOrder', 2, 'isActive', true, 'scaleMax', 5),
    jsonb_build_object('id', '00000000-0000-4000-8000-000000000003', 'code', 'participation', 'name', '참여도', 'displayOrder', 3, 'isActive', true, 'scaleMax', 5)
  );
$$;

create or replace function private.lesson_record_default_supplement_types()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_array(
    jsonb_build_object('id', '00000000-0000-4000-8000-000000000011', 'code', 'test', 'name', '테스트', 'displayOrder', 1, 'isActive', true),
    jsonb_build_object('id', '00000000-0000-4000-8000-000000000012', 'code', 'homework', 'name', '숙제', 'displayOrder', 2, 'isActive', true)
  );
$$;

create or replace function private.ensure_academy_lesson_record_settings(p_academy_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  insert into public.academy_lesson_record_settings (
    academy_id, tests_enabled, student_memo_enabled, common_record_enabled, metrics, supplement_types
  ) values (
    p_academy_id, true, true, true, private.lesson_record_default_metrics(), private.lesson_record_default_supplement_types()
  ) on conflict (academy_id) do nothing;
end;
$$;

revoke all on function private.lesson_record_default_metrics() from public, anon, authenticated;
revoke all on function private.lesson_record_default_supplement_types() from public, anon, authenticated;
revoke all on function private.ensure_academy_lesson_record_settings(uuid) from public, anon, authenticated;
grant execute on function private.ensure_academy_lesson_record_settings(uuid) to service_role;

insert into public.academy_lesson_record_settings (
  academy_id, tests_enabled, student_memo_enabled, common_record_enabled, metrics, supplement_types
)
select id, true, true, true, private.lesson_record_default_metrics(), private.lesson_record_default_supplement_types()
from public.academies
on conflict (academy_id) do nothing;

-- Backfill only metadata. The existing score, test, memo and supplement values
-- are not rewritten; the snapshot records the form that existed at migration.
update public.daily_subject_records dsr
set record_form_snapshot = jsonb_build_object(
  'testsEnabled', settings.tests_enabled,
  'studentMemoEnabled', settings.student_memo_enabled,
  'commonRecordEnabled', settings.common_record_enabled,
  'metrics', settings.metrics,
  'supplementTypes', settings.supplement_types
)
from public.academy_lesson_record_settings settings
where dsr.academy_id = settings.academy_id
  and dsr.record_form_snapshot is null;

create or replace function public.save_daily_records_with_record_settings_transaction(
  p_academy_id uuid,
  p_block_id uuid,
  p_class_id uuid,
  p_record_date date,
  p_save_mode text,
  p_attendance_rows jsonb,
  p_subject_rows jsonb,
  p_homework jsonb,
  p_expected_block_ids uuid[],
  p_draft_student_ids uuid[],
  p_published_student_ids uuid[],
  p_actor_profile_id uuid,
  p_supplement_rows jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_row record;
begin
  v_result := public.save_daily_records_with_grouped_homework_transaction(
    p_academy_id, p_block_id, p_class_id, p_record_date, p_save_mode,
    p_attendance_rows, p_subject_rows, p_homework, p_expected_block_ids,
    p_draft_student_ids, p_published_student_ids, p_actor_profile_id,
    p_supplement_rows
  );

  if p_subject_rows is not null and jsonb_typeof(p_subject_rows) = 'array' then
    for v_row in
      select * from jsonb_to_recordset(p_subject_rows) as item(
        student_id uuid,
        record_form_snapshot jsonb,
        metric_values jsonb,
        supplement_items jsonb
      )
    loop
      update public.daily_subject_records
      set record_form_snapshot = coalesce(v_row.record_form_snapshot, record_form_snapshot),
          metric_values = coalesce(v_row.metric_values, metric_values),
          supplement_items = coalesce(v_row.supplement_items, supplement_items)
      where academy_id = p_academy_id
        and block_id = p_block_id
        and student_id = v_row.student_id
        and record_date = p_record_date;
    end loop;
  end if;

  if p_supplement_rows is not null and jsonb_typeof(p_supplement_rows) = 'array' then
    for v_row in
      select * from jsonb_to_recordset(p_supplement_rows) as item(
        student_id uuid,
        supplement_items jsonb
      )
    loop
      update public.student_supplement_tasks task
      set supplement_items = coalesce(v_row.supplement_items, task.supplement_items)
      from public.daily_subject_records record_row
      where task.academy_id = p_academy_id
        and task.source_subject_record_id = record_row.id
        and record_row.academy_id = p_academy_id
        and record_row.block_id = p_block_id
        and record_row.student_id = v_row.student_id
        and record_row.record_date = p_record_date;
    end loop;
  end if;

  return v_result || jsonb_build_object('record_settings_snapshot_saved', true);
end;
$$;

revoke all on function public.save_daily_records_with_record_settings_transaction(uuid, uuid, uuid, date, text, jsonb, jsonb, jsonb, uuid[], uuid[], uuid[], uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_daily_records_with_record_settings_transaction(uuid, uuid, uuid, date, text, jsonb, jsonb, jsonb, uuid[], uuid[], uuid[], uuid, jsonb) to service_role;

commit;
