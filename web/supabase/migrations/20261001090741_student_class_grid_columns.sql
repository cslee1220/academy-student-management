alter table public.academy_operation_settings
  add column if not exists student_class_grid_columns integer not null default 5;

alter table public.academy_operation_settings
  add constraint academy_operation_settings_student_class_grid_columns_check
  check (student_class_grid_columns between 1 and 5);
