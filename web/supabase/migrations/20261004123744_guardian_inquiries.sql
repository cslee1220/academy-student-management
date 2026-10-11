create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  guardian_id uuid not null references public.guardians (id) on delete restrict,
  status text not null default 'received' check (status in ('received', 'answered', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inquiry_messages (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries (id) on delete cascade,
  author_type text not null check (author_type in ('guardian', 'teacher', 'admin')),
  author_id uuid not null,
  body text not null,
  created_at timestamptz not null default now(),
  hidden_at timestamptz,
  hidden_reason text
);

create index if not exists inquiries_guardian_created_at_idx on public.inquiries (academy_id, guardian_id, created_at desc);
create index if not exists inquiry_messages_inquiry_created_at_idx on public.inquiry_messages (inquiry_id, created_at);

create or replace function private.inquiries_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists inquiries_set_updated_at on public.inquiries;
create trigger inquiries_set_updated_at
before update on public.inquiries
for each row execute function private.inquiries_set_updated_at();

alter table public.inquiries enable row level security;
alter table public.inquiry_messages enable row level security;
revoke all on table public.inquiries, public.inquiry_messages from anon, authenticated;
grant select, insert, update on table public.inquiries, public.inquiry_messages to authenticated;

drop policy if exists inquiries_select on public.inquiries;
create policy inquiries_select on public.inquiries
for select to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    guardian_id in (select g.id from public.guardians g where g.auth_user_id = auth.uid())
    and private.guardian_can_view_student(academy_id, student_id)
  )
  or (
    private.has_academy_role(academy_id, array['teacher']::text[])
    and private.teacher_can_access_student(academy_id, student_id)
  )
);

drop policy if exists inquiries_insert on public.inquiries;
create policy inquiries_insert on public.inquiries
for insert to authenticated
with check (
  guardian_id in (select g.id from public.guardians g where g.auth_user_id = auth.uid())
  and private.guardian_can_view_student(academy_id, student_id)
);

drop policy if exists inquiries_update on public.inquiries;
create policy inquiries_update on public.inquiries
for update to authenticated
using (
  private.has_academy_role(academy_id, array['academy_admin']::text[])
  or (
    guardian_id in (select g.id from public.guardians g where g.auth_user_id = auth.uid())
    and private.guardian_can_view_student(academy_id, student_id)
  )
  or (
    private.has_academy_role(academy_id, array['teacher']::text[])
    and private.teacher_can_access_student(academy_id, student_id)
  )
)
with check (true);

drop policy if exists inquiry_messages_select on public.inquiry_messages;
create policy inquiry_messages_select on public.inquiry_messages
for select to authenticated
using (
  hidden_at is null
  and exists (select 1 from public.inquiries i where i.id = inquiry_messages.inquiry_id and (
    private.has_academy_role(i.academy_id, array['academy_admin']::text[])
    or (i.guardian_id in (select g.id from public.guardians g where g.auth_user_id = auth.uid()) and private.guardian_can_view_student(i.academy_id, i.student_id))
    or (private.has_academy_role(i.academy_id, array['teacher']::text[]) and private.teacher_can_access_student(i.academy_id, i.student_id))
  ))
);

drop policy if exists inquiry_messages_insert on public.inquiry_messages;
create policy inquiry_messages_insert on public.inquiry_messages
for insert to authenticated
with check (
  (author_type = 'guardian' and author_id in (select g.id from public.guardians g where g.auth_user_id = auth.uid()))
  or (author_type = 'teacher' and author_id = private.current_profile_id())
  or (author_type = 'admin' and private.has_academy_role((select i.academy_id from public.inquiries i where i.id = inquiry_messages.inquiry_id), array['academy_admin']::text[]))
);
