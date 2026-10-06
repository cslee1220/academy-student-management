begin;

-- Keep the original lesson date and the teacher-assigned supplement date separate.
-- Existing same-day supplement records are backfilled to preserve current behavior.
alter table public.daily_subject_records
  add column if not exists test_supplement_date date,
  add column if not exists homework_supplement_date date;

alter table public.student_supplement_tasks
  add column if not exists test_supplement_date date,
  add column if not exists homework_supplement_date date;

update public.daily_subject_records
set test_supplement_date = record_date
where is_test_supplementary = true
  and test_supplement_date is null;

update public.daily_subject_records
set homework_supplement_date = record_date
where is_homework_supplementary = true
  and homework_supplement_date is null;

update public.student_supplement_tasks
set test_supplement_date = record_date
where (is_test_supplementary = true or legacy_supplementary = true)
  and test_supplement_date is null;

update public.student_supplement_tasks
set homework_supplement_date = record_date
where is_homework_supplementary = true
  and homework_supplement_date is null;

create index if not exists student_supplement_tasks_test_date_idx
  on public.student_supplement_tasks (academy_id, test_supplement_date, is_active);

create index if not exists student_supplement_tasks_homework_date_idx
  on public.student_supplement_tasks (academy_id, homework_supplement_date, is_active);

commit;
