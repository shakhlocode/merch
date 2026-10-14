begin;
alter table public.employee_directory add column legal_entity text;
alter table public.orders add column fulfillment_mode text check(fulfillment_mode in ('office','remote_shipping','remote_visit')),
 add column legal_entity text, add column pickup_office_id uuid, add column pickup_office_name text, add column pickup_office_address text,
 add column visit_from date, add column visit_until date;
create table public.pickup_offices (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 120),
 address text not null default '' check(length(address)<=1000), is_active boolean not null default true, sort integer not null default 0
);
alter table public.orders add constraint orders_pickup_office_fk foreign key(pickup_office_id) references public.pickup_offices(id);
insert into public.pickup_offices(name,sort) values ('Офис 1',1),('Офис 2',2),('Офис 3',3);
alter table public.pickup_offices enable row level security;
grant select,insert,update on public.pickup_offices to authenticated;
create policy offices_read on public.pickup_offices for select to authenticated using(public.has_system_access() and (is_active or public.is_admin()));
create policy offices_admin_insert on public.pickup_offices for insert to authenticated with check(public.is_admin());
create policy offices_admin_update on public.pickup_offices for update to authenticated using(public.is_admin()) with check(public.is_admin());
alter table public.merch_settings add column pickup_message text not null default 'Спасибо за заказ! Дату, время и место раздачи объявим во внутрикоме — следите за обновлениями.' check(length(pickup_message) between 1 and 4000);
alter table public.orders add constraint fulfillment_shape check (
 fulfillment_mode is null or
 (fulfillment_mode='office' and not is_remote and pickup_office_id is not null and visit_from is null and visit_until is null and comment is null) or
 (fulfillment_mode='remote_shipping' and is_remote and pickup_office_id is null and country is not null and city is not null and visit_from is null and visit_until is null) or
 (fulfillment_mode='remote_visit' and not is_remote and pickup_office_id is not null and visit_from is not null and visit_until is not null and visit_until>=visit_from)
);
create table public.order_tasks (
 id uuid primary key default gen_random_uuid(),order_id uuid not null unique references public.orders(id) on delete cascade,
 due_on date not null,reserve_until date not null check(reserve_until>=due_on),
 contacted_at timestamptz,contacted_by uuid references public.employees(id),closed_at timestamptz,created_at timestamptz not null default now()
);
create index order_tasks_open_due on public.order_tasks(due_on) where closed_at is null;
alter table public.order_tasks enable row level security;
grant select on public.order_tasks to authenticated;
create policy tasks_admin_read on public.order_tasks for select to authenticated using(public.is_admin());

create function public.my_checkout_identity() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('full_name',d.full_name,'legal_entity',d.legal_entity) from public.employee_directory d join public.employees e on (lower(d.email)=lower(e.email) or d.invitation_user_id=e.id)
 where e.id=auth.uid() and public.has_system_access() and (not d.invitation_required or d.invitation_user_id=e.id) limit 1;
$$;
revoke all on function public.my_checkout_identity() from public,anon;
grant execute on function public.my_checkout_identity() to authenticated;

create function public.create_merch_order_v2(p_items jsonb,p_mode text,p_office_id uuid,p_phone text,p_country text,p_city text,p_comment text,p_visit_from date,p_visit_until date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare office public.pickup_offices%rowtype; ident jsonb; result jsonb; o public.orders%rowtype; today date:=(now() at time zone 'Asia/Tashkent')::date;
begin
 if auth.uid() is null then raise exception 'authentication_required'; end if;
 if p_mode is null or p_mode not in ('office','remote_shipping','remote_visit') then raise exception 'Выберите формат работы и получения'; end if;
 if p_phone is null or length(regexp_replace(p_phone,'[^0-9]','','g')) not between 7 and 15 or length(p_phone)>40 then raise exception 'Укажите корректный номер телефона'; end if;
 if p_mode in ('office','remote_visit') then
  select * into office from public.pickup_offices where id=p_office_id and is_active for share;
  if not found then raise exception 'Выберите действующий офис получения'; end if;
 end if;
 if p_mode='remote_shipping' and (nullif(trim(p_country),'') is null or nullif(trim(p_city),'') is null) then raise exception 'Укажите страну и город'; end if;
 if length(coalesce(p_country,''))>120 or length(coalesce(p_city,''))>120 or length(coalesce(p_comment,''))>2000 then raise exception 'Слишком длинное значение поля'; end if;
 if p_mode='remote_visit' and (p_visit_from is null or p_visit_until is null or p_visit_until<p_visit_from or p_visit_until<today) then raise exception 'Укажите корректные даты визита в Ташкент'; end if;
 ident:=public.my_checkout_identity();
 result:=public.create_merch_order(p_items,'office',case when p_mode='remote_shipping' then concat_ws(', ',trim(p_country),trim(p_city)) else concat_ws(', ',office.name,nullif(office.address,'')) end,p_phone,case when p_mode='office' then null else nullif(trim(p_comment),'') end,p_mode='remote_shipping',case when p_mode='remote_shipping' then trim(p_country) else null end);
 update public.orders set fulfillment_mode=p_mode,full_name=coalesce(ident->>'full_name',full_name),legal_entity=ident->>'legal_entity',
 city=case when p_mode='remote_shipping' then trim(p_city) else 'Ташкент' end,
 pickup_office_id=case when p_mode<>'remote_shipping' then office.id end,pickup_office_name=case when p_mode<>'remote_shipping' then office.name end,pickup_office_address=case when p_mode<>'remote_shipping' then office.address end,
 visit_from=case when p_mode='remote_visit' then p_visit_from end,visit_until=case when p_mode='remote_visit' then p_visit_until end
 where id=(result->>'id')::uuid returning * into o;
 if p_mode='remote_visit' then
  insert into public.order_tasks(order_id,due_on,reserve_until) values(o.id,p_visit_from,p_visit_until);
  insert into public.order_events(order_id,actor_id,action,data) values(o.id,auth.uid(),'visit_reserved',jsonb_build_object('arrival',p_visit_from,'departure',p_visit_until,'office',office.name));
 end if;
 return result||jsonb_build_object('pickup_code',o.pickup_code,'fulfillment_mode',p_mode,'pickup_message',case when p_mode='remote_shipping' then 'Спасибо, заказ получен! Ответственный сотрудник свяжется с вами и согласует отправку.' else coalesce((select pickup_message from public.merch_settings where id=1),'Спасибо за заказ! О раздаче сообщим во внутрикоме.') end);
end; $$;
revoke all on function public.create_merch_order_v2(jsonb,text,uuid,text,text,text,text,date,date) from public,anon;
grant execute on function public.create_merch_order_v2(jsonb,text,uuid,text,text,text,text,date,date) to authenticated;

create function public.close_order_task() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status in ('received','cancelled','rejected') then update public.order_tasks set closed_at=coalesce(closed_at,now()) where order_id=new.id; end if;
 return new;
end; $$;
create trigger close_order_task after update of status on public.orders for each row execute function public.close_order_task();
revoke all on function public.close_order_task() from public,anon,authenticated;
create function public.admin_contact_visit(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare t public.order_tasks%rowtype;
begin
 if not public.is_admin() then raise exception 'not_admin'; end if;
 select * into t from public.order_tasks where id=p_id for update;
 if not found or t.closed_at is not null then raise exception 'Задача уже закрыта'; end if;
 if (now() at time zone 'Asia/Tashkent')::date<t.due_on then raise exception 'Отметить связь можно в день приезда или позже'; end if;
 if t.contacted_at is null then
  update public.order_tasks set contacted_at=now(),contacted_by=auth.uid() where id=t.id;
  insert into public.order_events(order_id,actor_id,action) values(t.order_id,auth.uid(),'visit_contacted');
 end if;
end; $$;
revoke all on function public.admin_contact_visit(uuid) from public,anon;
grant execute on function public.admin_contact_visit(uuid) to authenticated;
create or replace function public.admin_import_employees(p_rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; added integer:=0; skipped integer:=0; n integer; mail text; new_id uuid; created_ids jsonb:='[]'::jsonb;
begin
 if not exists(select 1 from public.employees where id=auth.uid() and is_admin and is_active) then raise exception 'not_admin'; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'Передайте список сотрудников'; end if;
 if jsonb_array_length(p_rows) not between 1 and 2000 then raise exception 'За один раз можно загрузить от 1 до 2000 сотрудников'; end if;
 for item in select value from jsonb_array_elements(p_rows) loop
   mail:=lower(trim(item->>'email'));
   if coalesce(mail,'')='' and item->>'invite_mode'='code' then
     if nullif(trim(item->>'external_id'),'') is null then raise exception 'Для входа без почты нужен идентификатор'; end if;
     if exists(select 1 from public.employee_directory where external_id=trim(item->>'external_id')) then skipped:=skipped+1; continue; end if;
     mail:='pending-'||gen_random_uuid()::text||'@no-mail.merch.invalid';
   end if;
   if item->>'invite_mode'='code' and nullif(trim(item->>'external_id'),'') is null then raise exception 'Для личной ссылки нужен идентификатор'; end if;
   if mail is null or mail !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or nullif(trim(item->>'full_name'),'') is null then raise exception 'Проверьте email и ФИО во всех строках'; end if;
   insert into public.employee_directory(email,full_name,legal_entity,external_id,access_mode,access_expires_at,invitation_required,invitation_one_order) values(mail,trim(item->>'full_name'),nullif(trim(item->>'legal_entity'),''),nullif(trim(item->>'external_id'),''),coalesce(item->>'access_mode','unlimited'),(item->>'access_expires_at')::timestamptz,coalesce(item->>'invite_mode','none')<>'none',coalesce(item->>'invite_mode','none')<>'none') on conflict (lower(email)) do nothing returning id into new_id;
   get diagnostics n=row_count; if n=1 then created_ids:=created_ids||jsonb_build_array(new_id); end if; added:=added+n; skipped:=skipped+1-n;
 end loop;
 return jsonb_build_object('added',added,'skipped',skipped,'employee_ids',created_ids);
end; $$;
commit;
