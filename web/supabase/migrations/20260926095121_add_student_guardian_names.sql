-- Store the names that belong to each student's two guardian contact slots.

alter table public.students
  add column guardian1_name text,
  add column guardian2_name text;
