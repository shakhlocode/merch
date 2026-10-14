begin;
alter table public.employee_directory alter column hired_at drop not null;
alter table public.employee_directory add column if not exists external_id text;
create unique index employee_directory_external_id_key on public.employee_directory(external_id) where external_id is not null;
create or replace function public.get_employee_merch_access(p_email text)
returns table(is_allowed boolean,reason text,hired_at date,months_worked integer)
language plpgsql security definer set search_path = '' as $$
declare d public.employee_directory%rowtype;
begin
  if auth.uid() is null or (not public.is_admin() and not exists (
    select 1 from public.employees e where e.id=auth.uid() and lower(e.email)=lower(p_email)
  )) then raise exception 'not_allowed'; end if;
  select * into d from public.employee_directory where lower(email)=lower(p_email);
  return query select
    coalesce(d.is_active,false),
    case when d.id is null then 'employee_not_in_directory' when not d.is_active then 'employee_inactive' else 'ok' end,
    d.hired_at,
    case when d.hired_at is null then null else
      extract(year from age(current_date,d.hired_at))::integer*12 + extract(month from age(current_date,d.hired_at))::integer end;
end; $$;

create or replace function public.audit_directory_identifier() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.external_id is distinct from old.external_id then
    insert into public.employee_audit_log(employee_directory_id,actor_id,action,changed_fields) values(new.id,auth.uid(),'update',jsonb_build_object('external_id',jsonb_build_array(old.external_id,new.external_id)));
  end if;
  return new;
end; $$;
create trigger directory_identifier_audit after update on public.employee_directory for each row execute function public.audit_directory_identifier();
create or replace function public.admin_import_employees(p_rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; added integer:=0; skipped integer:=0; n integer; mail text;
begin
 if not exists(select 1 from public.employees where id=auth.uid() and is_admin and is_active) then raise exception 'not_admin'; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'Передайте список сотрудников'; end if;
 if jsonb_array_length(p_rows) not between 1 and 2000 then raise exception 'За один раз можно загрузить от 1 до 2000 сотрудников'; end if;
 for item in select value from jsonb_array_elements(p_rows) loop
   mail:=lower(trim(item->>'email'));
   if mail is null or mail !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or nullif(trim(item->>'full_name'),'') is null then raise exception 'Проверьте email и ФИО во всех строках'; end if;
   insert into public.employee_directory(email,full_name,external_id) values(mail,trim(item->>'full_name'),nullif(trim(item->>'external_id'),'')) on conflict (lower(email)) do nothing;
   get diagnostics n=row_count; added:=added+n; skipped:=skipped+1-n;
 end loop;
 return jsonb_build_object('added',added,'skipped',skipped);
end; $$;
revoke all on function public.audit_directory_identifier() from public,anon,authenticated;
revoke all on function public.admin_import_employees(jsonb) from public,anon;
grant execute on function public.admin_import_employees(jsonb) to authenticated;
commit;
