-- Store two normalized student contact numbers and each contact's relationship.

alter table public.students
  add column phone2 text,
  add column phone_relationship text,
  add column phone2_relationship text;

create index students_academy_phone2_idx on public.students (academy_id, phone2);
