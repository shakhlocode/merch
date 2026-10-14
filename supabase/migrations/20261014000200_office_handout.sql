begin;

create function public.generate_pickup_code() returns text
language sql volatile set search_path='' as $$
  select lpad((('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint)::text,10,'0')
      || lpad((('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint)::text,10,'0');
$$;

alter table public.orders
  add column pickup_code text unique,
  add column version integer not null default 0,
  add column received_by uuid references public.employees(id) on delete set null,
  add column received_by_name text,
  add column remote_contact_name text;
update public.orders set pickup_code=public.generate_pickup_code() where not is_remote;
alter table public.orders add constraint pickup_code_format check (
  (is_remote and pickup_code is null) or
  (not is_remote and pickup_code is not null and pickup_code ~ '^[0-9]{20}$')
);

create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  actor_id uuid references public.employees(id) on delete set null,
  action text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.order_events(order_id,created_at);
create unique index order_issued_once on public.order_events(order_id) where action='issued';
alter table public.order_events enable row level security;
create policy order_events_admin_read on public.order_events for select to authenticated using(public.is_admin());
revoke all on public.order_events from anon,authenticated;
grant select on public.order_events to authenticated;

create function public.initialize_order_handout() returns trigger
language plpgsql security definer set search_path='' as $$
declare a public.employees%rowtype;
begin
  new.delivery_type := 'office';
  if new.is_remote then
    new.pickup_code := null;
    select * into a from public.employees where is_admin and is_active order by created_at,id limit 1;
    new.assigned_to := a.id;
    new.remote_contact_name := a.full_name;
  else
    new.pickup_code := public.generate_pickup_code();
  end if;
  return new;
end; $$;
create trigger order_initialize_handout before insert on public.orders
for each row execute function public.initialize_order_handout();

create function public.record_new_order() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.order_events(order_id,actor_id,action,data)
    values(new.id,auth.uid(),'created',jsonb_build_object('is_remote',new.is_remote));
  return new;
end; $$;
create trigger order_record_created after insert on public.orders
for each row execute function public.record_new_order();

create function public.admin_save_order(
  p_order_id uuid,p_status public.order_status,p_expected_version integer,
  p_admin_comment text,p_tracking_number text,p_storage_location text,p_assigned_to uuid
) returns public.orders language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; i record; movement public.movement_type; delta integer; actor text; contact text;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if p_expected_version is null or p_expected_version<>o.version then raise exception 'order_changed'; end if;
  if p_status is null then raise exception 'invalid_order_status'; end if;
  if o.status in ('received','cancelled','rejected') and p_status<>o.status then raise exception 'terminal_order_cannot_reopen'; end if;
  if not o.is_remote and p_status='received' and o.status<>'received' then raise exception 'use_pickup_scan'; end if;
  if not o.is_remote and p_status='shipped' and o.status<>'shipped' then raise exception 'office_pickup_only'; end if;
  if o.status='shipped' and p_status in ('new','review','confirmed','assembling','ready') then raise exception 'shipped_order_cannot_reopen'; end if;
  if p_status='ready' and not exists(select 1 from public.order_items where order_id=o.id) then raise exception 'cart_is_empty'; end if;
  if p_assigned_to is not null then
    select full_name into contact from public.employees where id=p_assigned_to and is_admin and is_active;
    if not found then raise exception 'contact_not_admin'; end if;
  end if;
  select full_name into actor from public.employees where id=auth.uid();
  if o.status not in ('shipped','received','cancelled','rejected') and p_status in ('shipped','received') then
    movement:='write_off';delta:=-1;
  elsif o.status not in ('shipped','received','cancelled','rejected') and p_status in ('cancelled','rejected') then
    movement:='unreserve';delta:=1;
  elsif o.status='shipped' and p_status in ('cancelled','rejected') then
    movement:='return';delta:=1;
  end if;
  if movement is not null then
    for i in select * from public.order_items where order_id=o.id order by variant_id loop
      insert into public.stock_movements(variant_id,movement_type,qty,order_id,comment,created_by)
        values(i.variant_id,movement,delta*i.qty,o.id,'Order status: '||p_status::text,auth.uid());
    end loop;
  end if;
  update public.orders set status=p_status,admin_comment=p_admin_comment,tracking_number=p_tracking_number,
    storage_location=p_storage_location,assigned_to=p_assigned_to,
    remote_contact_name=case when is_remote then contact else null end,
    pickup_status=case when p_status='ready' then 'packed' when p_status in ('cancelled','rejected') then 'refused'
      when p_status='received' then 'handed_owner' else 'pending' end,
    confirmed_at=case when p_status='confirmed' then coalesce(confirmed_at,now()) else confirmed_at end,
    shipped_at=case when p_status='shipped' then coalesce(shipped_at,now()) else shipped_at end,
    received_at=case when p_status='received' then coalesce(received_at,now()) else received_at end,
    received_by=case when p_status='received' then coalesce(received_by,auth.uid()) else received_by end,
    received_by_name=case when p_status='received' then coalesce(received_by_name,actor) else received_by_name end,
    cancelled_at=case when p_status in ('cancelled','rejected') then coalesce(cancelled_at,now()) else cancelled_at end,
    version=version+1 where id=o.id returning * into o;
  insert into public.order_events(order_id,actor_id,action,data)
    values(o.id,auth.uid(),'updated',jsonb_build_object('status',p_status,'actor_name',actor));
  return o;
end; $$;

-- Preserve the existing RPC signature for older clients, with the new guards.
create or replace function public.admin_update_order(p_order_id uuid,p_status public.order_status,p_admin_comment text,p_tracking_number text)
returns public.orders language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  return public.admin_save_order(o.id,p_status,o.version,p_admin_comment,p_tracking_number,o.storage_location,o.assigned_to);
end; $$;

-- Legacy handout RPC may update storage metadata, but cannot issue an order.
create or replace function public.admin_set_order_handout(p_order_id uuid,p_storage_location text,p_pickup_status text,p_handed_to text)
returns public.orders language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if p_pickup_status is distinct from o.pickup_status then raise exception 'use_order_status'; end if;
  update public.orders set storage_location=p_storage_location,version=version+1 where id=o.id returning * into o;
  return o;
end; $$;

create function public.admin_issue_order(p_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; i record; actor text; repeated boolean;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  if p_code is null or p_code !~ '^[0-9]{20}$' then raise exception 'invalid_pickup_code'; end if;
  select * into o from public.orders where pickup_code=p_code for update;
  if not found or o.is_remote then raise exception 'pickup_not_found'; end if;
  repeated := o.status='received';
  if not repeated then
    if o.status<>'ready' or o.pickup_status<>'packed' then raise exception 'order_not_ready'; end if;
    select full_name into actor from public.employees where id=auth.uid();
    for i in select * from public.order_items where order_id=o.id order by variant_id loop
      insert into public.stock_movements(variant_id,movement_type,qty,order_id,comment,created_by)
        values(i.variant_id,'write_off',-i.qty,o.id,'Office handout',auth.uid());
    end loop;
    update public.orders set status='received',pickup_status='handed_owner',received_at=now(),
      received_by=auth.uid(),received_by_name=actor,handed_to=full_name,version=version+1
      where id=o.id returning * into o;
    insert into public.order_events(order_id,actor_id,action,data)
      values(o.id,auth.uid(),'issued',jsonb_build_object('actor_name',actor,'recipient',o.full_name));
  end if;
  return jsonb_build_object('order_id',o.id,'order_number',o.order_number,'already_issued',repeated,
    'received_at',o.received_at,'issued_by_name',o.received_by_name,'recipient',o.full_name);
end; $$;

create function public.admin_replace_order_items(p_order_id uuid,p_items jsonb,p_expected_version integer)
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

revoke all on function public.generate_pickup_code(),public.initialize_order_handout(),public.record_new_order(),
  public.admin_save_order(uuid,public.order_status,integer,text,text,text,uuid),
  public.admin_issue_order(text),public.admin_replace_order_items(uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.admin_save_order(uuid,public.order_status,integer,text,text,text,uuid),
  public.admin_issue_order(text),public.admin_replace_order_items(uuid,jsonb,integer) to authenticated;
commit;
