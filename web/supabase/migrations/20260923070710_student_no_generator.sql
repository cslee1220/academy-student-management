create or replace function public.next_student_no(p_academy_id uuid, p_registered_at date)
returns text
language plpgsql
set search_path = public, extensions
as $$
declare
  month_prefix text := to_char(p_registered_at, 'YYYYMM');
  next_sequence integer;
begin
  if p_academy_id is null or p_registered_at is null then
    raise exception using errcode = '22004', message = '학원과 등록일이 필요합니다.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_academy_id::text || ':' || month_prefix, 0));

  select coalesce(max(substring(student_no from 7 for 3)::integer), 0) + 1
    into next_sequence
  from public.students
  where academy_id = p_academy_id
    and student_no ~ ('^' || month_prefix || '[0-9]{3}$');

  if next_sequence > 999 then
    raise exception using errcode = '22003', message = '등록 연월별 학생 번호가 999명을 초과했습니다.';
  end if;

  return month_prefix || lpad(next_sequence::text, 3, '0');
end;
$$;

revoke all on function public.next_student_no(uuid, date) from public, anon, authenticated;
grant execute on function public.next_student_no(uuid, date) to service_role;
