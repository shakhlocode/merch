begin;
alter table public.employee_directory
 add column access_mode text not null default 'unlimited' check(access_mode in ('unlimited','until_date','one_order')),
 add column access_expires_at timestamptz,
 add column access_used_at timestamptz;
alter table public.employee_directory add constraint directory_access_expiry check((access_mode='until_date' and access_expires_at is not null) or (access_mode<>'until_date' and access_expires_at is null));
create or replace function public.get_employee_merch_access(p_email text)
returns table(is_allowed boolean,reason text,hired_at date,months_worked integer)
language plpgsql security definer set search_path='' as $$
declare d public.employee_directory%rowtype;
begin
 if auth.uid() is null or (not public.is_admin() and not exists(select 1 from public.employees e where e.id=auth.uid() and lower(e.email)=lower(p_email))) then raise exception 'not_allowed'; end if;
 select * into d from public.employee_directory where lower(email)=lower(p_email);
 return query select
  coalesce(d.is_active and (d.access_mode<>'until_date' or d.access_expires_at>now()) and (d.access_mode<>'one_order' or d.access_used_at is null),false),
  case when d.id is null then 'employee_not_in_directory' when not d.is_active then 'employee_inactive'
   when d.access_mode='until_date' and d.access_expires_at<=now() then 'access_expired'
   when d.access_mode='one_order' and d.access_used_at is not null then 'access_order_received' else 'ok' end,
  d.hired_at,case when d.hired_at is null then null else extract(year from age(current_date,d.hired_at))::int*12+extract(month from age(current_date,d.hired_at))::int end;
end; $$;
create function public.has_system_access() returns boolean language sql stable security definer set search_path='' as $$
 select public.is_admin() or exists(select 1 from public.employees e join public.employee_directory d on lower(d.email)=lower(e.email)
 where e.id=auth.uid() and e.is_active and d.is_active and (d.access_mode<>'until_date' or d.access_expires_at>now()) and (d.access_mode<>'one_order' or d.access_used_at is null));
$$;
revoke all on function public.has_system_access() from public,anon;
grant execute on function public.has_system_access() to authenticated;
do $$ declare tab text; begin
 foreach tab in array array['products','product_variants','categories','orders','order_items','carts','cart_items','product_limits','merch_settings'] loop
 execute format('create policy system_access_required on public.%I as restrictive for all to authenticated using(public.has_system_access()) with check(public.has_system_access())',tab);
 end loop;
end $$;
create function public.check_order_access() returns trigger language plpgsql security definer set search_path='' as $$
declare d public.employee_directory%rowtype;
begin
 select dr.* into d from public.employee_directory dr join public.employees e on lower(e.email)=lower(dr.email) where e.id=new.employee_id for update of dr;
 if not found or not d.is_active then raise exception 'employee_not_allowed'; end if;
 if d.access_mode='until_date' and d.access_expires_at<=now() then raise exception 'access_expired'; end if;
 if d.access_mode='one_order' then
   if d.access_used_at is not null then raise exception 'access_order_received'; end if;
   if exists(select 1 from public.orders where employee_id=new.employee_id and status not in ('received','cancelled','rejected')) then raise exception 'single_order_pending'; end if;
 end if;
 return new;
end; $$;
create trigger order_access_guard before insert on public.orders for each row execute function public.check_order_access();
create function public.close_access_after_receipt() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='received' and old.status is distinct from new.status then
  update public.employee_directory d set access_used_at=now() from public.employees e
   where e.id=new.employee_id and lower(d.email)=lower(e.email) and d.access_mode='one_order' and d.access_used_at is null;
 end if;
 return new;
end; $$;
create trigger close_access_after_receipt after update of status on public.orders for each row execute function public.close_access_after_receipt();
create function public.reset_changed_access() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.access_mode is distinct from old.access_mode or new.access_expires_at is distinct from old.access_expires_at then new.access_used_at:=null; end if;
 return new;
end; $$;
create trigger reset_changed_access before update on public.employee_directory for each row execute function public.reset_changed_access();
create function public.audit_access_policy() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.access_mode,new.access_expires_at,new.access_used_at) is distinct from (old.access_mode,old.access_expires_at,old.access_used_at) then
 insert into public.employee_audit_log(employee_directory_id,actor_id,action,changed_fields) values(new.id,auth.uid(),'access_change',jsonb_build_object('access_mode',jsonb_build_array(old.access_mode,new.access_mode),'access_expires_at',jsonb_build_array(old.access_expires_at,new.access_expires_at),'access_used_at',jsonb_build_array(old.access_used_at,new.access_used_at)));
 end if;
 return new;
end; $$;
create trigger audit_access_policy after update on public.employee_directory for each row execute function public.audit_access_policy();
revoke all on function public.check_order_access(),public.close_access_after_receipt(),public.reset_changed_access(),public.audit_access_policy() from public,anon,authenticated;
create or replace function public.admin_import_employees(p_rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; added integer:=0; skipped integer:=0; n integer; mail text;
begin
 if not exists(select 1 from public.employees where id=auth.uid() and is_admin and is_active) then raise exception 'not_admin'; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'Передайте список сотрудников'; end if;
 if jsonb_array_length(p_rows) not between 1 and 2000 then raise exception 'За один раз можно загрузить от 1 до 2000 сотрудников'; end if;
 for item in select value from jsonb_array_elements(p_rows) loop
   mail:=lower(trim(item->>'email'));
   if mail is null or mail !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or nullif(trim(item->>'full_name'),'') is null then raise exception 'Проверьте email и ФИО во всех строках'; end if;
   insert into public.employee_directory(email,full_name,external_id,access_mode,access_expires_at) values(mail,trim(item->>'full_name'),nullif(trim(item->>'external_id'),''),coalesce(item->>'access_mode','unlimited'),(item->>'access_expires_at')::timestamptz) on conflict (lower(email)) do nothing;
   get diagnostics n=row_count; added:=added+n; skipped:=skipped+1-n;
 end loop;
 return jsonb_build_object('added',added,'skipped',skipped);
end; $$;

commit;
