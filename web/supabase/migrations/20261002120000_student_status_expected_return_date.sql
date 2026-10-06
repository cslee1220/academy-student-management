alter table public.student_status_history
  add column if not exists expected_return_date date;

create index if not exists student_status_history_academy_expected_return_idx
  on public.student_status_history (academy_id, next_status, expected_return_date);
