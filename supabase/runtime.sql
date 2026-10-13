-- Missing runtime behavior reconstructed from the application contract.
-- Lock stock rows so simultaneous orders cannot reserve the same last item.
create or replace function public.apply_stock_movement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v public.product_variants%rowtype; n integer;
begin
  select * into v from public.product_variants where id = new.variant_id for update;
  if not found then raise exception 'variant_not_found'; end if;
  if new.movement_type in ('income','unreserve','return') and new.qty <= 0 then
    raise exception 'positive_stock_quantity_required';
  end if;
  if new.movement_type in ('reserve','write_off') and new.qty >= 0 then
    raise exception 'negative_stock_quantity_required';
  end if;
  if new.movement_type = 'reserve' then
    n := -new.qty;
    if v.total_qty - v.reserved_qty < n then raise exception 'product_is_not_available'; end if;
    update public.product_variants set reserved_qty = reserved_qty + n where id = v.id;
  elsif new.movement_type = 'unreserve' then
    if v.reserved_qty < new.qty then raise exception 'invalid_stock_release'; end if;
    update public.product_variants set reserved_qty = reserved_qty - new.qty where id = v.id;
  elsif new.movement_type = 'write_off' then
    n := -new.qty;
    if new.order_id is not null then
      if v.reserved_qty < n then raise exception 'invalid_stock_write_off'; end if;
      update public.product_variants set total_qty = total_qty - n, reserved_qty = reserved_qty - n where id = v.id;
    else
      update public.product_variants set total_qty = total_qty - n where id = v.id;
    end if;
  else
    update public.product_variants set total_qty = total_qty + new.qty where id = v.id;
  end if;
  return new;
end; $$;
create trigger stock_movement_apply after insert on public.stock_movements
for each row execute function public.apply_stock_movement();

create or replace function public.create_merch_order(
  p_items jsonb, p_delivery_type public.delivery_type, p_delivery_address text,
  p_phone text, p_comment text, p_is_remote boolean, p_country text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.employees%rowtype; a record; o public.orders%rowtype; v record;
  item jsonb; total integer; unique_products integer;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  select * into e from public.employees where id = auth.uid();
  if not found or not e.is_active then raise exception 'employee_not_allowed'; end if;
  select * into a from public.get_employee_merch_access(e.email);
  if not coalesce(a.is_allowed, false) then raise exception '%', coalesce(a.reason,'employee_not_allowed'); end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'cart_is_empty'; end if;
  total := jsonb_array_length(p_items);
  if total = 0 then raise exception 'cart_is_empty'; end if;
  if total > 3 then raise exception 'max_unique_products_exceeded'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    if item->>'variant_id' is null then raise exception 'product_is_not_available'; end if;
    if jsonb_typeof(item->'qty') <> 'number' or (item->>'qty')::numeric is distinct from 1 then
      raise exception 'one_unit_per_product_only';
    end if;
  end loop;
  select count(distinct pv.product_id) into unique_products
    from jsonb_array_elements(p_items) i
    join public.product_variants pv on pv.id = (i->>'variant_id')::uuid;
  if unique_products <> total then raise exception 'one_variant_per_product_only'; end if;
  -- Sorted lock acquisition prevents deadlocks for baskets in different orders.
  perform pv.id from public.product_variants pv
    where pv.id in (select (i->>'variant_id')::uuid from jsonb_array_elements(p_items) i)
    order by pv.id for update;
  for v in select pv.*, p.name as product_name, p.is_active as product_active
    from public.product_variants pv join public.products p on p.id = pv.product_id
    where pv.id in (select (i->>'variant_id')::uuid from jsonb_array_elements(p_items) i)
  loop
    if not v.is_active or not v.product_active or v.total_qty - v.reserved_qty < 1 then
      raise exception 'product_is_not_available';
    end if;
  end loop;
  insert into public.orders(employee_id,delivery_type,delivery_address,full_name,phone,email,city,department,comment,is_remote,country)
    values(e.id,coalesce(p_delivery_type,'office'),p_delivery_address,e.full_name,coalesce(p_phone,e.phone),e.email,e.city,
      coalesce(e.business_unit,e.department),p_comment,coalesce(p_is_remote,false),
      case when p_is_remote then nullif(trim(p_country),'') else null end) returning * into o;
  for v in select pv.*, p.name as product_name from public.product_variants pv
    join public.products p on p.id = pv.product_id
    where pv.id in (select (i->>'variant_id')::uuid from jsonb_array_elements(p_items) i)
    order by pv.id
  loop
    insert into public.order_items(order_id,product_id,variant_id,product_name,size,color,sku,qty)
      values(o.id,v.product_id,v.id,v.product_name,v.size,v.color,v.sku,1);
    insert into public.stock_movements(variant_id,movement_type,qty,order_id,comment,created_by)
      values(v.id,'reserve',-1,o.id,'Reserve for merch order',e.id);
  end loop;
  return jsonb_build_object('id',o.id,'order_number',o.order_number);
end; $$;

-- The old admin function was not provided. Reconstructed lifecycle:
-- reserve on create, write off on shipped/received, release on cancellation,
-- return stock if a shipped order is cancelled. Terminal orders cannot reopen.
create or replace function public.admin_update_order(
  p_order_id uuid, p_status public.order_status, p_admin_comment text, p_tracking_number text
) returns public.orders language plpgsql security definer set search_path = '' as $$
declare o public.orders%rowtype; i record; movement public.movement_type; delta integer;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  if p_status is null then raise exception 'invalid_order_status'; end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if o.status in ('received','cancelled','rejected') and p_status <> o.status then
    raise exception 'terminal_order_cannot_reopen';
  end if;
  if o.status = 'shipped' and p_status in ('new','review','confirmed','assembling') then
    raise exception 'shipped_order_cannot_reopen';
  end if;
  if o.status not in ('shipped','received','cancelled','rejected') and p_status in ('shipped','received') then
    movement := 'write_off'; delta := -1;
  elsif o.status not in ('shipped','received','cancelled','rejected') and p_status in ('cancelled','rejected') then
    movement := 'unreserve'; delta := 1;
  elsif o.status = 'shipped' and p_status in ('cancelled','rejected') then
    movement := 'return'; delta := 1;
  end if;
  if movement is not null then
    for i in select * from public.order_items where order_id = o.id order by variant_id loop
      insert into public.stock_movements(variant_id,movement_type,qty,order_id,comment,created_by)
        values(i.variant_id,movement,delta*i.qty,o.id,'Order status: ' || p_status::text,auth.uid());
    end loop;
  end if;
  update public.orders set status=p_status, admin_comment=p_admin_comment, tracking_number=p_tracking_number,
    confirmed_at=case when p_status='confirmed' then coalesce(confirmed_at,now()) else confirmed_at end,
    shipped_at=case when p_status='shipped' then coalesce(shipped_at,now()) else shipped_at end,
    received_at=case when p_status='received' then coalesce(received_at,now()) else received_at end,
    cancelled_at=case when p_status in ('cancelled','rejected') then coalesce(cancelled_at,now()) else cancelled_at end
    where id=o.id returning * into o;
  return o;
end; $$;

create or replace function public.update_my_profile(
  p_full_name text,p_phone text,p_department text,p_position text,p_city text,p_office text
) returns public.employees language plpgsql security definer set search_path = '' as $$
declare e public.employees%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if nullif(trim(p_full_name),'') is null then raise exception 'full_name_required'; end if;
  update public.employees set full_name=trim(p_full_name),phone=p_phone,department=p_department,
    position=p_position,city=p_city,office=p_office where id=auth.uid() returning * into e;
  if not found then raise exception 'employee_not_found'; end if;
  return e;
end; $$;

-- Restrict the directory lookup to the current user's own email or an admin.
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
    coalesce(d.is_active and d.hired_at <= (current_date-interval '3 months')::date,false),
    case when d.id is null then 'employee_not_in_directory' when not d.is_active then 'employee_inactive'
      when d.hired_at > current_date-interval '3 months' then 'employee_tenure_too_short' else 'ok' end,
    d.hired_at,
    case when d.hired_at is null then null else
      extract(year from age(current_date,d.hired_at))::integer*12 + extract(month from age(current_date,d.hired_at))::integer end;
end; $$;

create view public.product_variants_available with (security_invoker=true) as
select pv.*, pv.total_qty-pv.reserved_qty as available_qty from public.product_variants pv;

create trigger products_touch_updated_at before update on public.products for each row execute function public.touch_updated_at();
create trigger variants_touch_updated_at before update on public.product_variants for each row execute function public.touch_updated_at();
create trigger carts_touch_updated_at before update on public.carts for each row execute function public.touch_updated_at();

alter table public.employees enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_limits enable row level security;
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.stock_movements enable row level security;

create policy emp_read_own on public.employees for select to authenticated using(id=auth.uid() or public.is_admin());
create policy emp_admin_all on public.employees for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy cat_read on public.categories for select to authenticated using(true);
create policy cat_admin_write on public.categories for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy prod_read on public.products for select to authenticated using(is_active or public.is_admin());
create policy prod_admin_write on public.products for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy var_read on public.product_variants for select to authenticated using(public.is_admin() or (is_active and exists(
  select 1 from public.products p where p.id=product_id and p.is_active)));
create policy var_admin_write on public.product_variants for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy limits_read on public.product_limits for select to authenticated using(true);
create policy limits_admin_write on public.product_limits for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy carts_own on public.carts for all to authenticated using(employee_id=auth.uid()) with check(employee_id=auth.uid());
create policy cart_items_own on public.cart_items for all to authenticated using(exists(
  select 1 from public.carts c where c.id=cart_id and c.employee_id=auth.uid())) with check(exists(
  select 1 from public.carts c where c.id=cart_id and c.employee_id=auth.uid()));
create policy orders_read on public.orders for select to authenticated using(employee_id=auth.uid() or public.is_admin());
create policy order_items_read on public.order_items for select to authenticated using(public.is_admin() or exists(
  select 1 from public.orders o where o.id=order_id and o.employee_id=auth.uid()));
create policy stock_admin_read on public.stock_movements for select to authenticated using(public.is_admin());
create policy stock_admin_insert on public.stock_movements for insert to authenticated
  with check(public.is_admin() and movement_type in ('income','adjustment') and order_id is null and created_by=auth.uid());

-- Supabase default grants can be broad; reset table/function privileges explicitly.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.employees,public.categories,public.products,public.product_variants,
  public.product_variants_available,public.product_limits,public.carts,public.cart_items,
  public.orders,public.order_items,public.stock_movements,public.employee_directory,
  public.employee_audit_log,public.merch_settings to authenticated;
grant insert,update,delete on public.employees,public.categories,public.products,public.product_limits,
  public.carts,public.cart_items,public.employee_directory to authenticated;
grant insert,update on public.merch_settings to authenticated;
grant insert on public.product_variants,public.stock_movements to authenticated;
grant update(size,color,sku,is_active) on public.product_variants to authenticated;
grant execute on function public.is_admin(),public.mark_password_set(),public.get_employee_merch_access(text),
  public.create_merch_order(jsonb,public.delivery_type,text,text,text,boolean,text),
  public.admin_update_order(uuid,public.order_status,text,text),public.admin_set_order_handout(uuid,text,text,text),
  public.update_my_profile(text,text,text,text,text,text) to authenticated;

-- Prevent administrators bypassing the ledger when creating a variant.
create function public.check_initial_stock() returns trigger language plpgsql set search_path='' as $$
begin
  if new.total_qty <> 0 or new.reserved_qty <> 0 then raise exception 'use_stock_movements_for_initial_stock'; end if;
  return new;
end; $$;
create trigger variant_initial_stock before insert on public.product_variants
for each row execute function public.check_initial_stock();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('merch-products','merch-products',true,5242880,array['image/jpeg','image/png','image/webp','image/gif']);
create policy merch_images_read on storage.objects for select to anon,authenticated using(bucket_id='merch-products');
create policy merch_images_admin_insert on storage.objects for insert to authenticated
  with check(bucket_id='merch-products' and public.is_admin());
create policy merch_images_admin_update on storage.objects for update to authenticated
  using(bucket_id='merch-products' and public.is_admin()) with check(bucket_id='merch-products' and public.is_admin());
create policy merch_images_admin_delete on storage.objects for delete to authenticated
  using(bucket_id='merch-products' and public.is_admin());
