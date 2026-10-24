alter table public.parent_consultations
  add column if not exists class_id uuid references public.classes (id) on delete set null;

alter table public.parent_consultations
  add column if not exists operation_group text;

alter table public.parent_consultations
  drop constraint if exists parent_consultations_operation_group_check;

alter table public.parent_consultations
  add constraint parent_consultations_operation_group_check
  check (operation_group is null or operation_group in ('A', 'B'));

create index if not exists parent_consultations_class_scope_idx
  on public.parent_consultations (academy_id, class_id, consultation_at desc);
