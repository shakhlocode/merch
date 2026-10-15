begin;

-- One employee grant, separate shops and physical inventories. Existing history
-- and stock stay in Ecom. Only product definitions and configuration are copied.
create table public.business_units (
 id uuid primary key, slug text not null unique, name text not null unique
);
insert into public.business_units values
 ('10000000-0000-4000-8000-000000000001','fintech','Fintech'),
 ('10000000-0000-4000-8000-000000000002','ecom','Ecom'),
 ('10000000-0000-4000-8000-000000000003','technologies','Technologies');
create table public.shop_admins (
 email text not null check(email=lower(trim(email))),
 unit_id uuid not null references public.business_units(id),
 primary key(email,unit_id)
);
create table public.shop_super_admins (email text primary key check(email=lower(trim(email))));
insert into public.shop_super_admins values('shahlo.kham@gmail.com');
insert into public.shop_admins select lower(email),'10000000-0000-4000-8000-000000000002'::uuid
 from public.employees where is_admin;

create function public.is_super_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.employees e join public.shop_super_admins a on a.email=lower(e.email)
 where e.id=auth.uid() and e.is_active);
$$;
create function public.unit_is_admin(p_unit uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_super_admin() or exists(select 1 from public.employees e join public.shop_admins a on a.email=lower(e.email)
 where e.id=auth.uid() and e.is_active and a.unit_id=p_unit);
$$;

-- Add the key before installing context functions that read the directory.
do $$ declare t text; begin
 foreach t in array array['categories','products','product_variants','product_limits','carts','cart_items','orders','order_items','stock_movements','employee_directory','employee_audit_log','merch_settings','order_events','employee_invitations','pickup_offices','order_tasks','fulfillment_choices'] loop
  execute format('alter table public.%I add column unit_id uuid not null default %L references public.business_units(id)',t,'10000000-0000-4000-8000-000000000002');
  execute format('create index on public.%I(unit_id)',t);
 end loop;
end $$;

create function public.current_unit_id() returns uuid language plpgsql stable security definer set search_path='' as $$
declare requested text; chosen uuid; assigned uuid;
begin
 requested:=nullif(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-merch-unit','');
 select d.unit_id into assigned from public.employee_directory d join public.employees e
 on lower(d.email)=lower(e.email) or d.invitation_user_id=e.id where e.id=auth.uid() limit 1;
 if requested is not null then
  if requested !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return null; end if;
  chosen:=requested::uuid;
  if auth.uid() is null or public.unit_is_admin(chosen) or chosen=assigned then return chosen; end if;
  return null;
 end if;
 if public.is_super_admin() then return coalesce(assigned,'10000000-0000-4000-8000-000000000002'::uuid); end if;
 select a.unit_id into chosen from public.shop_admins a join public.employees e on a.email=lower(e.email)
 where e.id=auth.uid() and e.is_active order by a.unit_id limit 1;
 return coalesce(chosen,assigned,case when auth.uid() is null then '10000000-0000-4000-8000-000000000002'::uuid end);
end; $$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select public.current_unit_id() is not null and public.unit_is_admin(public.current_unit_id());
$$;

do $$ declare t text; begin
 foreach t in array array['categories','products','product_variants','product_limits','carts','cart_items','orders','order_items','stock_movements','employee_directory','employee_audit_log','merch_settings','order_events','employee_invitations','pickup_offices','order_tasks','fulfillment_choices'] loop
  execute format('alter table public.%I alter column unit_id set default public.current_unit_id()',t);
  execute format('create policy unit_isolation on public.%I as restrictive for all to authenticated using(unit_id=public.current_unit_id()) with check(unit_id=public.current_unit_id())',t);
 end loop;
end $$;

-- These helpers must bypass RLS to avoid recursion while evaluating policies.
-- The selected unit is checked explicitly rather than trusting HR attributes.
do $$ declare f record; definition text; begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='my_store_scope' loop
  definition:=pg_get_functiondef(f.oid);
  definition:=replace(definition,'where e.id=auth.uid()','where d.unit_id=public.current_unit_id() and e.id=auth.uid()');
  execute definition;
 end loop;
end $$;

-- Keep employee identity global; registry changes never grant global roles or
-- disable administrators. Shop access is evaluated from the registry itself.
create or replace function public.sync_employee_from_directory() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.employees set full_name=new.full_name,department=coalesce(new.business_unit,department),
 business_unit=new.business_unit,position=new.position,hired_at=new.hired_at,
 is_active=case when new.is_active then true else is_active end
 where lower(email)=lower(new.email) or id=new.invitation_user_id;
 return new;
end; $$;
create unique index directory_one_account on public.employee_directory(invitation_user_id) where invitation_user_id is not null;

-- Composite references make mixing variants, offices, invitations and orders
-- from different shops impossible, including inside privileged functions.
do $$ declare t text; begin
 foreach t in array array['categories','products','product_variants','carts','orders','employee_directory','pickup_offices','fulfillment_choices'] loop
  execute format('alter table public.%I add unique(unit_id,id)',t);
 end loop;
end $$;
alter table public.products add foreign key(unit_id,category_id) references public.categories(unit_id,id);
alter table public.product_variants add foreign key(unit_id,product_id) references public.products(unit_id,id);
alter table public.product_limits add foreign key(unit_id,product_id) references public.products(unit_id,id);
alter table public.cart_items add foreign key(unit_id,cart_id) references public.carts(unit_id,id),
 add foreign key(unit_id,product_id) references public.products(unit_id,id),add foreign key(unit_id,variant_id) references public.product_variants(unit_id,id);
alter table public.orders add foreign key(unit_id,pickup_office_id) references public.pickup_offices(unit_id,id),
 add foreign key(unit_id,fulfillment_choice_id) references public.fulfillment_choices(unit_id,id);
alter table public.order_items add foreign key(unit_id,order_id) references public.orders(unit_id,id),
 add foreign key(unit_id,product_id) references public.products(unit_id,id),add foreign key(unit_id,variant_id) references public.product_variants(unit_id,id);
alter table public.stock_movements add foreign key(unit_id,variant_id) references public.product_variants(unit_id,id),
 add foreign key(unit_id,order_id) references public.orders(unit_id,id);
alter table public.order_events add foreign key(unit_id,order_id) references public.orders(unit_id,id);
alter table public.order_tasks add foreign key(unit_id,order_id) references public.orders(unit_id,id);
alter table public.employee_audit_log add foreign key(unit_id,employee_directory_id) references public.employee_directory(unit_id,id);
alter table public.employee_invitations add foreign key(unit_id,employee_directory_id) references public.employee_directory(unit_id,id);
-- Keep one relationship per parent for PostgREST embedded selects.
do $$ declare f record; newer text; begin
 for f in select oid,conname,conrelid,confrelid from pg_constraint where contype='f' and cardinality(conkey)=1 and connamespace='public'::regnamespace loop
  select c.conname into newer from pg_constraint c where c.contype='f' and c.conrelid=f.conrelid and c.confrelid=f.confrelid and cardinality(c.conkey)=2 limit 1;
  if newer is not null then
   execute format('alter table %s drop constraint %I',f.conrelid::regclass,f.conname);
   execute format('alter table %s rename constraint %I to %I',f.conrelid::regclass,newer,f.conname);
  end if;
 end loop;
end $$;
alter table public.merch_settings drop constraint merch_settings_pkey,add primary key(unit_id,id);
alter table public.categories drop constraint categories_name_key,add unique(unit_id,name);
alter table public.product_variants drop constraint product_variants_sku_key,add unique(unit_id,sku);
drop index public.fulfillment_choice_mode_unique;
create unique index fulfillment_choice_mode_unique on public.fulfillment_choices(unit_id,mode) where mode<>'placeholder' and deleted_at is null;
alter table public.product_variants add column stock_family_id uuid not null default gen_random_uuid(),add unique(unit_id,stock_family_id);

-- Copy definitions only, with new IDs. No employee, order, invitation, movement,
-- reservation or physical quantity is duplicated.
do $$ declare u uuid; c record; p record; new_c uuid; new_p uuid; begin
 foreach u in array array['10000000-0000-4000-8000-000000000001'::uuid,'10000000-0000-4000-8000-000000000003'::uuid] loop
  insert into public.categories(unit_id,name,sort) select u,name,sort from public.categories where unit_id='10000000-0000-4000-8000-000000000002';
  for p in select * from public.products where unit_id='10000000-0000-4000-8000-000000000002' loop
   new_c:=null;
   select nc.id into new_c from public.categories old_c join public.categories nc on nc.name=old_c.name and nc.unit_id=u where old_c.id=p.category_id;
   insert into public.products(unit_id,name,description,material,category_id,image_url,images,is_active,placement)
   values(u,p.name,p.description,p.material,new_c,p.image_url,p.images,p.is_active,p.placement) returning id into new_p;
   insert into public.product_variants(unit_id,product_id,size,color,sku,is_active,low_stock_threshold,stock_family_id)
    select u,new_p,size,color,sku,is_active,low_stock_threshold,stock_family_id from public.product_variants where product_id=p.id;
   insert into public.product_limits(unit_id,product_id,limit_per_emp,period,department)
    select u,new_p,limit_per_emp,period,department from public.product_limits where product_id=p.id;
  end loop;
  insert into public.pickup_offices(unit_id,name,address,is_active,sort,deleted_at) select u,name,address,is_active,sort,deleted_at from public.pickup_offices where unit_id='10000000-0000-4000-8000-000000000002';
  insert into public.fulfillment_choices(unit_id,name,mode,is_active,sort,deleted_at) select u,name,mode,is_active,sort,deleted_at from public.fulfillment_choices where unit_id='10000000-0000-4000-8000-000000000002';
  insert into public.merch_settings select (jsonb_populate_record(null::public.merch_settings,to_jsonb(s)||jsonb_build_object('unit_id',u))).* from public.merch_settings s where unit_id='10000000-0000-4000-8000-000000000002';
 end loop;
end $$;

-- Use a non-login, non-bypass role for business RPCs. They retain atomic stock
-- operations but can only see/write their selected unit, even by guessed UUID.
-- Hosted Supabase does not allow postgres to grant USAGE on the auth schema to
-- custom roles. Keep that lookup inside a minimal helper owned by postgres.
create function public.request_user_id() returns uuid language sql stable security definer set search_path='' as $$ select auth.uid(); $$;
revoke all on function public.request_user_id() from public,anon;
create role merch_executor nologin noinherit nobypassrls;
grant merch_executor to postgres;
grant usage on schema public to merch_executor;
grant create on schema public to merch_executor;
grant all on all tables in schema public to merch_executor;
grant usage,select on all sequences in schema public to merch_executor;
grant execute on all functions in schema public to merch_executor;
do $$ declare t text; f record; definition text; begin
 foreach t in array array['categories','products','product_variants','product_limits','carts','cart_items','orders','order_items','stock_movements','employee_directory','employee_audit_log','merch_settings','order_events','employee_invitations','pickup_offices','order_tasks','fulfillment_choices'] loop
  execute format('create policy rpc_access on public.%I for all to merch_executor using(true) with check(true)',t);
  execute format('alter policy unit_isolation on public.%I to authenticated,merch_executor',t);
 end loop;
 create policy rpc_identity_read on public.employees for select to merch_executor using(true);
 create policy rpc_identity_update on public.employees for update to merch_executor using(id=auth.uid()) with check(id=auth.uid());
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prosecdef and p.prorettype<>'trigger'::regtype
 and p.proname not in ('is_admin','is_super_admin','unit_is_admin','current_unit_id','my_store_scope','has_shop_access','has_system_access','claim_invitation','_claim_invitation_base','check_invitation_code','mark_password_set','request_user_id') loop
  definition:=replace(pg_get_functiondef(f.oid),'auth.uid()','public.request_user_id()');
  execute definition;
  if f.proname='admin_import_employees' then
   definition:=replace(pg_get_functiondef(f.oid),'not exists(select 1 from public.employees where id=auth.uid() and is_admin and is_active)','not public.is_admin()');
   execute definition;
  end if;
  if f.proname='create_merch_order' then
   definition:=replace(pg_get_functiondef(f.oid),'perform p.id from public.products',
    'if exists(select 1 from jsonb_array_elements(p_items) requested where not exists(select 1 from public.product_variants available where available.id=(requested->>''variant_id'')::uuid)) then raise exception ''product_is_not_available''; end if; perform p.id from public.products');
   execute definition;
  end if;
  execute format('alter function %s owner to merch_executor',f.oid::regprocedure);
 end loop;
end $$;
revoke create on schema public from merch_executor;
revoke all on public.shop_admins,public.shop_super_admins,public.business_units from merch_executor;
grant select on public.business_units to merch_executor;

-- No global profile/role writes from a unit administrator.
drop policy emp_admin_all on public.employees;
revoke insert,update,delete on public.employees from authenticated;
create function public.employee_admin_for_unit(p_employee uuid,p_unit uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.employees e where e.id=p_employee and e.is_active and
 (exists(select 1 from public.shop_super_admins a where a.email=lower(e.email)) or exists(select 1 from public.shop_admins a where a.email=lower(e.email) and a.unit_id=p_unit)));
$$;
drop policy emp_read_own on public.employees;
create policy emp_read_own on public.employees for select to authenticated using(id=auth.uid() or (public.is_admin() and
 (public.employee_admin_for_unit(id,public.current_unit_id()) or exists(select 1 from public.employee_directory d where d.invitation_user_id=employees.id or lower(d.email)=lower(employees.email)))));

create or replace function public.initialize_order_handout() returns trigger language plpgsql security definer set search_path='' as $$
declare a public.employees%rowtype;
begin
 new.delivery_type:='office';
 if new.assigned_to is null then
  select * into a from public.employees where public.employee_admin_for_unit(id,new.unit_id) order by created_at,id limit 1;
  new.assigned_to:=a.id;
 else
  select * into a from public.employees where id=new.assigned_to and public.employee_admin_for_unit(id,new.unit_id);
  if not found then raise exception 'contact_not_admin'; end if;
 end if;
 if new.is_remote then new.pickup_code:=null;new.remote_contact_name:=a.full_name;
 else new.pickup_code:=public.generate_pickup_code(); end if;
 return new;
end; $$;
do $$ declare f record; d text; begin
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('admin_save_order','order_responsible_contacts') loop
  d:=pg_get_functiondef(f.oid);
  d:=replace(d,'id=p_assigned_to and is_admin and is_active','id=p_assigned_to and public.employee_admin_for_unit(id,public.current_unit_id())');
  d:=replace(d,'e.is_admin and e.is_active','public.employee_admin_for_unit(e.id,o.unit_id)');
  execute d;
 end loop;
end $$;

-- Audits and service-only invitation activation inherit their parent unit.
create function public.keep_record_unit() returns trigger language plpgsql security definer set search_path='' as $$
declare parent uuid;
begin
 if tg_op='UPDATE' and new.unit_id is distinct from old.unit_id then raise exception 'unit_is_immutable'; end if;
 if tg_table_name in ('employee_audit_log','employee_invitations') then
  select unit_id into parent from public.employee_directory where id=new.employee_directory_id;
 elsif tg_table_name in ('order_tasks','order_events') then
  select unit_id into parent from public.orders where id=new.order_id;
 end if;
 if parent is not null then new.unit_id:=parent; end if;
 return new;
end; $$;
do $$ declare t text; begin
 foreach t in array array['categories','products','product_variants','product_limits','carts','cart_items','orders','order_items','stock_movements','employee_directory','employee_audit_log','merch_settings','order_events','employee_invitations','pickup_offices','order_tasks','fulfillment_choices'] loop
  execute format('create trigger a_keep_unit before insert or update on public.%I for each row execute function public.keep_record_unit()',t);
 end loop;
end $$;

-- Service-only activation chooses the unit from the invitation, not the caller.
create or replace function public.claim_invitation(p_id uuid,p_user_id uuid,p_code_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; scope text; u uuid;
begin
 select unit_id into u from public.employee_invitations where id=p_id;
 if u is null then raise exception 'invite_unavailable'; end if;
 perform set_config('request.headers',jsonb_build_object('x-merch-unit',u)::text,true);
 result:=public._claim_invitation_base(p_id,p_user_id,p_code_hash);
 select i.store_scope into scope from public.employee_invitations i join public.employee_directory d on d.id=i.employee_directory_id where i.id=p_id and i.store_scope=d.store_scope;
 if scope is null then raise exception 'invite_unavailable'; end if;
 return result||jsonb_build_object('unit_id',u,'next',(case when scope='welcome' then '/welcome' else '/catalog' end)||'?unit='||u::text);
end; $$;

alter table public.business_units enable row level security;
alter table public.shop_admins enable row level security;
alter table public.shop_super_admins enable row level security;
grant select on public.business_units to authenticated;
create policy units_read on public.business_units for select to authenticated using(public.unit_is_admin(id) or id=public.current_unit_id());

create function public.my_shop_context() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('unit_id',public.current_unit_id(),'is_admin',public.is_admin(),'is_super_admin',public.is_super_admin(),
 'units',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'slug',u.slug) order by u.name) from public.business_units u where public.unit_is_admin(u.id) or u.id=public.current_unit_id()),'[]'::jsonb));
$$;
create function public.admin_shop_contacts() returns table(id uuid,full_name text,email text,phone text) language sql stable security definer set search_path='' as $$
 select e.id,e.full_name,e.email,e.phone from public.employees e where public.is_admin() and public.employee_admin_for_unit(e.id,public.current_unit_id()) order by e.full_name;
$$;
create function public.super_admin_roles() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_super_admin() then raise exception 'not_super_admin'; end if;
 return jsonb_build_object('admins',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.shop_admins a),
 'super_admins',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.shop_super_admins a));
end; $$;
create function public.super_set_admin(p_email text,p_unit uuid,p_super boolean,p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
declare mail text:=lower(trim(p_email));
begin
 if not public.is_super_admin() then raise exception 'not_super_admin'; end if;
 if mail !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'invalid_email'; end if;
 if p_super then
  if not p_enabled and exists(select 1 from public.employees where id=auth.uid() and lower(email)=mail) then raise exception 'Нельзя снять собственные права суперадминистратора'; end if;
  if p_enabled then insert into public.shop_super_admins values(mail) on conflict do nothing;
  else delete from public.shop_super_admins where email=mail; end if;
 else
  if p_unit is null then raise exception 'Выберите магазин'; end if;
  if p_enabled then insert into public.shop_admins values(mail,p_unit) on conflict do nothing;
  else delete from public.shop_admins where email=mail and unit_id=p_unit; end if;
 end if;
 -- An explicitly granted administrator can log in without a customer grant.
 if p_enabled then update public.employees set is_active=true where lower(email)=mail; end if;
end; $$;

-- New admin signups honour an email role assigned before registration.
create function public.activate_shop_admin() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.shop_admins where email=lower(new.email)) or exists(select 1 from public.shop_super_admins where email=lower(new.email)) then new.is_active:=true; end if;
 return new;
end; $$;
create trigger activate_shop_admin before insert on public.employees for each row execute function public.activate_shop_admin();

-- Image writes use unit prefixes. Existing images remain readable so cloned
-- cards keep their photos, but a unit admin cannot overwrite another shop's.
drop policy merch_images_admin_insert on storage.objects;
drop policy merch_images_admin_update on storage.objects;
drop policy merch_images_admin_delete on storage.objects;
create policy merch_images_admin_insert on storage.objects for insert to authenticated with check(bucket_id='merch-products' and public.is_admin() and split_part(name,'/',1)=public.current_unit_id()::text);
create policy merch_images_admin_update on storage.objects for update to authenticated using(bucket_id='merch-products' and public.is_admin() and split_part(name,'/',1)=public.current_unit_id()::text) with check(bucket_id='merch-products' and public.is_admin() and split_part(name,'/',1)=public.current_unit_id()::text);
create policy merch_images_admin_delete on storage.objects for delete to authenticated using(bucket_id='merch-products' and public.is_admin() and split_part(name,'/',1)=public.current_unit_id()::text);

-- Explicit grants; private helpers and role tables have no direct client writes.
revoke all on function public.is_super_admin(),public.unit_is_admin(uuid),public.current_unit_id(),public.employee_admin_for_unit(uuid,uuid),public.my_shop_context(),public.admin_shop_contacts(),public.super_admin_roles(),public.super_set_admin(text,uuid,boolean,boolean),public.keep_record_unit(),public.activate_shop_admin() from public,anon;
grant execute on function public.is_super_admin(),public.unit_is_admin(uuid),public.current_unit_id(),public.employee_admin_for_unit(uuid,uuid),public.my_shop_context(),public.admin_shop_contacts(),public.super_admin_roles(),public.super_set_admin(text,uuid,boolean,boolean) to authenticated,merch_executor;
notify pgrst,'reload schema';
commit;
