begin;
alter table public.employee_directory add column store_scope text not null default 'catalog' check(store_scope in ('catalog','welcome'));
alter table public.employee_invitations add column store_scope text not null default 'catalog' check(store_scope in ('catalog','welcome'));
alter table public.orders add column order_scope text not null default 'catalog' check(order_scope in ('catalog','welcome'));
alter table public.merch_settings
 add column catalog_rules text not null default E'До 3 уникальных товаров.\nПо 1 штуке каждого товара.\nОдин товар — один размер и цвет.\nПолучение — в офисе. Для удалённых сотрудников — по согласованию.' check(length(catalog_rules) between 1 and 4000),
 add column welcome_rules text not null default E'Выберите до 3 товаров для своего Welcome pack.\nПо 1 штуке каждого товара.\nВыберите нужный размер и цвет.\nПолучение согласуем после оформления заказа.' check(length(welcome_rules) between 1 and 4000),
 add column shipping_message text not null default 'Спасибо, заказ получен! Ответственный сотрудник свяжется с вами и согласует отправку.' check(length(shipping_message) between 1 and 4000),
 add column visit_message text not null default 'Спасибо за заказ! Администратор свяжется с вами во время визита в Ташкент.' check(length(visit_message) between 1 and 4000),
 add column welcome_pickup_message text not null default 'Ваш Welcome pack заказан! Мы сообщим, когда и где его можно забрать.' check(length(welcome_pickup_message) between 1 and 4000),
 add column welcome_shipping_message text not null default 'Ваш Welcome pack заказан! Ответственный сотрудник свяжется с вами и согласует отправку.' check(length(welcome_shipping_message) between 1 and 4000),
 add column welcome_visit_message text not null default 'Ваш Welcome pack заказан! Мы свяжемся с вами во время визита в Ташкент.' check(length(welcome_visit_message) between 1 and 4000);
update public.merch_settings set visit_message=pickup_message;

create function public.my_store_scope() returns text language sql stable security definer set search_path='' as $$
 select d.store_scope from public.employees e join public.employee_directory d on (lower(d.email)=lower(e.email) or d.invitation_user_id=e.id)
 where e.id=auth.uid() and e.is_active and d.is_active
 and (not d.invitation_required or d.invitation_user_id=e.id)
 and (d.access_mode<>'until_date' or d.access_expires_at>now())
 and ((d.access_mode<>'one_order' and not d.invitation_one_order) or d.access_used_at is null)
 and (d.store_scope='catalog' or exists(select 1 from public.employee_invitations i where i.employee_directory_id=d.id and i.store_scope='welcome' and i.claimed_by=e.id and i.revoked_at is null)) limit 1;
$$;
create function public.has_shop_access(p_scope text) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public.my_store_scope()=p_scope,false) or (p_scope='catalog' and public.is_admin() and public.my_store_scope() is null);
$$;
create or replace function public.has_system_access() returns boolean language sql stable security definer set search_path='' as $$ select public.is_admin() or public.my_store_scope() is not null; $$;
revoke all on function public.my_store_scope(),public.has_shop_access(text) from public,anon;
grant execute on function public.my_store_scope(),public.has_shop_access(text) to authenticated;
revoke select on public.products,public.product_variants,public.categories,public.product_limits,public.merch_settings from anon;
create policy products_store_scope on public.products as restrictive for select to authenticated using(public.is_admin() or placement in (public.my_store_scope(),'both'));
create policy variants_store_scope on public.product_variants as restrictive for select to authenticated using(public.is_admin() or exists(select 1 from public.products p where p.id=product_id));
create policy categories_store_scope on public.categories as restrictive for select to authenticated using(public.is_admin() or exists(select 1 from public.products p where p.category_id=categories.id));
create policy limits_store_scope on public.product_limits as restrictive for select to authenticated using(public.is_admin() or exists(select 1 from public.products p where p.id=product_id));
create policy orders_store_scope on public.orders as restrictive for select to authenticated using(public.is_admin() or order_scope=public.my_store_scope());

alter function public.admin_create_invitation(uuid,uuid,text,text,text) rename to _admin_create_invitation_base;
revoke all on function public._admin_create_invitation_base(uuid,uuid,text,text,text) from public,anon,authenticated;
create function public.admin_create_invitation(p_id uuid,p_employee_id uuid,p_token_hash text,p_code_hash text,p_channel text,p_scope text default 'catalog') returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_scope is null or p_scope not in ('catalog','welcome') then raise exception 'Выберите раздел приглашения'; end if;
 result:=public._admin_create_invitation_base(p_id,p_employee_id,p_token_hash,p_code_hash,p_channel);
 update public.employee_directory set store_scope=p_scope where id=p_employee_id;
 update public.employee_invitations set store_scope=p_scope where id=p_id;
 return result||jsonb_build_object('store_scope',p_scope);
end; $$;
revoke all on function public.admin_create_invitation(uuid,uuid,text,text,text,text) from public,anon;
grant execute on function public.admin_create_invitation(uuid,uuid,text,text,text,text) to authenticated;
alter function public.claim_invitation(uuid,uuid,text) rename to _claim_invitation_base;
revoke all on function public._claim_invitation_base(uuid,uuid,text) from public,anon,authenticated;
create function public.claim_invitation(p_id uuid,p_user_id uuid,p_code_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; scope text;
begin
 result:=public._claim_invitation_base(p_id,p_user_id,p_code_hash);
 select i.store_scope into scope from public.employee_invitations i join public.employee_directory d on d.id=i.employee_directory_id where i.id=p_id and i.store_scope=d.store_scope;
 if scope is null then raise exception 'invite_unavailable'; end if;
 return result||jsonb_build_object('next',case when scope='welcome' then '/welcome' else '/catalog' end);
end; $$;
revoke all on function public.claim_invitation(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_invitation(uuid,uuid,text) to service_role;

alter function public.create_merch_order(jsonb,public.delivery_type,text,text,text,boolean,text) rename to _create_merch_order_stock;
revoke all on function public._create_merch_order_stock(jsonb,public.delivery_type,text,text,text,boolean,text) from public,anon,authenticated;
create function public.create_merch_order(p_items jsonb,p_delivery_type public.delivery_type,p_delivery_address text,p_phone text,p_comment text,p_is_remote boolean,p_country text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare scope text;
begin
 perform d.id from public.employee_directory d join public.employees e on (lower(d.email)=lower(e.email) or d.invitation_user_id=e.id) where e.id=auth.uid() for update of d;
 scope:=public.my_store_scope();
 if scope is null then raise exception 'employee_not_allowed'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'cart_is_empty'; end if;
 perform p.id from public.products p join public.product_variants v on v.product_id=p.id where v.id in(select (i->>'variant_id')::uuid from jsonb_array_elements(p_items) i) order by p.id for share of p;
 if exists(select 1 from public.product_variants v join public.products p on p.id=v.product_id where v.id in(select (i->>'variant_id')::uuid from jsonb_array_elements(p_items) i) and p.placement not in (scope,'both')) then raise exception 'product_scope_not_allowed'; end if;
 return public._create_merch_order_stock(p_items,p_delivery_type,p_delivery_address,p_phone,p_comment,p_is_remote,p_country);
end; $$;
revoke all on function public.create_merch_order(jsonb,public.delivery_type,text,text,text,boolean,text) from public,anon;
grant execute on function public.create_merch_order(jsonb,public.delivery_type,text,text,text,boolean,text) to authenticated;
create function public.configured_order_message(p_scope text,p_mode text) returns text language sql stable security definer set search_path='' as $$
 select case when p_scope='welcome' then case p_mode when 'remote_shipping' then welcome_shipping_message when 'remote_visit' then welcome_visit_message else welcome_pickup_message end
 else case p_mode when 'remote_shipping' then shipping_message when 'remote_visit' then visit_message else pickup_message end end from public.merch_settings where id=1;
$$;
revoke all on function public.configured_order_message(text,text) from public,anon,authenticated;
alter function public.create_merch_order_v2(jsonb,text,uuid,text,text,text,text,date,date) rename to _create_merch_order_v2_base;
revoke all on function public._create_merch_order_v2_base(jsonb,text,uuid,text,text,text,text,date,date) from public,anon,authenticated;
create function public.create_merch_order_v2(p_items jsonb,p_mode text,p_office_id uuid,p_phone text,p_country text,p_city text,p_comment text,p_visit_from date,p_visit_until date) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; scope text;
begin
 result:=public._create_merch_order_v2_base(p_items,p_mode,p_office_id,p_phone,p_country,p_city,p_comment,p_visit_from,p_visit_until);
 select order_scope into scope from public.orders where id=(result->>'id')::uuid;
 return result||jsonb_build_object('order_scope',scope,'pickup_message',public.configured_order_message(scope,p_mode));
end; $$;
revoke all on function public.create_merch_order_v2(jsonb,text,uuid,text,text,text,text,date,date) from public,anon;
grant execute on function public.create_merch_order_v2(jsonb,text,uuid,text,text,text,text,date,date) to authenticated;

create or replace function public.get_employee_merch_access(p_email text)
returns table(is_allowed boolean,reason text,hired_at date,months_worked integer)
language plpgsql security definer set search_path='' as $$
declare d public.employee_directory%rowtype;
begin
 if auth.uid() is null or (not public.is_admin() and not exists(select 1 from public.employees e where e.id=auth.uid() and lower(e.email)=lower(p_email))) then raise exception 'not_allowed'; end if;
 select dr.* into d from public.employee_directory dr left join public.employees e on e.id=dr.invitation_user_id where lower(dr.email)=lower(p_email) or lower(e.email)=lower(p_email) limit 1;
 return query select
  coalesce((d.store_scope='catalog' or exists(select 1 from public.employee_invitations i where i.employee_directory_id=d.id and i.store_scope='welcome' and i.claimed_by=d.invitation_user_id and i.revoked_at is null)) and d.is_active and (d.access_mode<>'until_date' or d.access_expires_at>now()) and ((d.access_mode<>'one_order' and not d.invitation_one_order) or d.access_used_at is null) and (not d.invitation_required or d.invitation_user_id=(select id from public.employees where lower(email)=lower(p_email))),false),
  case when d.id is null then 'employee_not_in_directory' when not d.is_active then 'employee_inactive' when d.invitation_required and d.invitation_user_id is distinct from (select id from public.employees where lower(email)=lower(p_email)) then 'invitation_required'
   when d.access_mode='until_date' and d.access_expires_at<=now() then 'access_expired'
   when (d.access_mode='one_order' or d.invitation_one_order) and d.access_used_at is not null then 'access_order_received' else 'ok' end,
  d.hired_at,case when d.hired_at is null then null else extract(year from age(current_date,d.hired_at))::int*12+extract(month from age(current_date,d.hired_at))::int end;
end; $$;

create or replace function public.check_order_access() returns trigger language plpgsql security definer set search_path='' as $$
declare d public.employee_directory%rowtype;
begin
 select dr.* into d from public.employee_directory dr join public.employees e on (lower(e.email)=lower(dr.email) or dr.invitation_user_id=e.id) where e.id=new.employee_id for update of dr;
 if not found or not d.is_active then raise exception 'employee_not_allowed'; end if;
 if d.access_mode='until_date' and d.access_expires_at<=now() then raise exception 'access_expired'; end if;
 if d.invitation_required and d.invitation_user_id is distinct from new.employee_id then raise exception 'invitation_required'; end if;
 if d.access_mode='one_order' or d.invitation_one_order then
   if d.access_used_at is not null then raise exception 'access_order_received'; end if;
   if exists(select 1 from public.orders where employee_id=new.employee_id and status not in ('received','cancelled','rejected')) then raise exception 'single_order_pending'; end if;
 end if;
 if new.email like '%@guest.merch.invalid' then new.email:=case when d.email like '%@%.merch.invalid' then null else d.email end; end if;
 new.order_scope:=d.store_scope;
 return new;
end; $$;


create or replace function public.admin_import_employees(p_rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; added integer:=0; skipped integer:=0; n integer; mail text; new_id uuid; created_ids jsonb:='[]'::jsonb;
begin
 if not exists(select 1 from public.employees where id=auth.uid() and is_admin and is_active) then raise exception 'not_admin'; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'Передайте список сотрудников'; end if;
 if jsonb_array_length(p_rows) not between 1 and 2000 then raise exception 'За один раз можно загрузить от 1 до 2000 сотрудников'; end if;
 for item in select value from jsonb_array_elements(p_rows) loop
   if item->>'invite_scope'='welcome' and coalesce(item->>'invite_mode','none') not in ('email','code') then raise exception 'Welcome pack доступен только по приглашению'; end if;
   mail:=lower(trim(item->>'email'));
   if coalesce(mail,'')='' and item->>'invite_mode'='code' then
     if nullif(trim(item->>'external_id'),'') is null then raise exception 'Для входа без почты нужен идентификатор'; end if;
     if exists(select 1 from public.employee_directory where external_id=trim(item->>'external_id')) then skipped:=skipped+1; continue; end if;
     mail:='pending-'||gen_random_uuid()::text||'@no-mail.merch.invalid';
   end if;
   if item->>'invite_mode'='code' and nullif(trim(item->>'external_id'),'') is null then raise exception 'Для личной ссылки нужен идентификатор'; end if;
   if mail is null or mail !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or nullif(trim(item->>'full_name'),'') is null then raise exception 'Проверьте email и ФИО во всех строках'; end if;
   insert into public.employee_directory(store_scope,email,full_name,legal_entity,external_id,access_mode,access_expires_at,invitation_required,invitation_one_order) values(coalesce(item->>'invite_scope','catalog'),mail,trim(item->>'full_name'),nullif(trim(item->>'legal_entity'),''),nullif(trim(item->>'external_id'),''),coalesce(item->>'access_mode','unlimited'),(item->>'access_expires_at')::timestamptz,coalesce(item->>'invite_mode','none')<>'none',coalesce(item->>'invite_mode','none')<>'none') on conflict (lower(email)) do nothing returning id into new_id;
   get diagnostics n=row_count; if n=1 then created_ids:=created_ids||jsonb_build_array(new_id); end if; added:=added+n; skipped:=skipped+1-n;
 end loop;
 return jsonb_build_object('added',added,'skipped',skipped,'employee_ids',created_ids);
end; $$;
create or replace function public.admin_replace_order_items(p_order_id uuid,p_items jsonb,p_expected_version integer)
returns public.orders language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; i record; item jsonb; n integer; unique_products integer; old_items jsonb;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if p_expected_version is null or p_expected_version<>o.version then raise exception 'order_changed'; end if;
  if o.status in ('shipped','received','cancelled','rejected') then raise exception 'order_items_locked'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'cart_is_empty'; end if;
  n:=jsonb_array_length(p_items);
  if n=0 then raise exception 'cart_is_empty'; end if;
  if n>3 then raise exception 'max_unique_products_exceeded'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    if item->>'variant_id' is null then raise exception 'product_is_not_available'; end if;
    if jsonb_typeof(item->'qty')<>'number' or (item->>'qty')::numeric is distinct from 1 then raise exception 'one_unit_per_product_only'; end if;
  end loop;
  select count(distinct pv.product_id) into unique_products from jsonb_array_elements(p_items) x
    join public.product_variants pv on pv.id=(x->>'variant_id')::uuid;
  if unique_products<>n then raise exception 'one_variant_per_product_only'; end if;
  perform p.id from public.products p join public.product_variants v on v.product_id=p.id where v.id in(select (x->>'variant_id')::uuid from jsonb_array_elements(p_items) x) order by p.id for share of p;
  if exists(select 1 from jsonb_array_elements(p_items) x join public.product_variants v on v.id=(x->>'variant_id')::uuid join public.products p on p.id=v.product_id where p.placement not in (o.order_scope,'both') and not exists(select 1 from public.order_items oi where oi.order_id=o.id and oi.variant_id=v.id)) then raise exception 'product_scope_not_allowed'; end if;
  perform id from public.product_variants where id in(
    select variant_id from public.order_items where order_id=o.id
    union select (x->>'variant_id')::uuid from jsonb_array_elements(p_items) x
  ) order by id for update;
  if exists(select 1 from jsonb_array_elements(p_items) x
    join public.product_variants pv on pv.id=(x->>'variant_id')::uuid
    join public.products p on p.id=pv.product_id where not pv.is_active or not p.is_active) then raise exception 'product_is_not_available'; end if;
  select jsonb_agg(to_jsonb(oi)) into old_items from public.order_items oi where order_id=o.id;
  for i in select * from public.order_items where order_id=o.id and variant_id not in(
    select (x->>'variant_id')::uuid from jsonb_array_elements(p_items) x) order by variant_id
  loop
    insert into public.stock_movements(variant_id,movement_type,qty,order_id,comment,created_by)
      values(i.variant_id,'unreserve',i.qty,o.id,'Order items changed',auth.uid());
  end loop;
  for i in select pv.*,p.name as product_name from jsonb_array_elements(p_items) x
    join public.product_variants pv on pv.id=(x->>'variant_id')::uuid
    join public.products p on p.id=pv.product_id order by pv.id
  loop
    if not exists(select 1 from public.order_items where order_id=o.id and variant_id=i.id) then
      insert into public.stock_movements(variant_id,movement_type,qty,order_id,comment,created_by)
        values(i.id,'reserve',-1,o.id,'Order items changed',auth.uid());
    end if;
  end loop;
  delete from public.order_items where order_id=o.id;
  insert into public.order_items(order_id,product_id,variant_id,product_name,size,color,sku,qty)
    select o.id,pv.product_id,pv.id,p.name,pv.size,pv.color,pv.sku,1 from jsonb_array_elements(p_items) x
    join public.product_variants pv on pv.id=(x->>'variant_id')::uuid join public.products p on p.id=pv.product_id;
  update public.orders set status=case when status='ready' then 'assembling'::public.order_status else status end,
    pickup_status='pending',version=version+1 where id=o.id returning * into o;
  insert into public.order_events(order_id,actor_id,action,data)
    values(o.id,auth.uid(),'items_changed',jsonb_build_object('before',old_items,'after',p_items));
  return o;
end; $$;
create policy item_scope_insert on public.order_items as restrictive for insert to authenticated with check(exists(select 1 from public.orders o join public.products p on p.id=product_id where o.id=order_id and p.placement in (o.order_scope,'both')));
notify pgrst, 'reload schema';
commit;
