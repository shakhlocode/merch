begin;
-- A warehouse transfer asks for a recipient BU, not an internal variant UUID.
-- Create a matching destination card/variant only when needed, atomically with
-- the existing idempotent stock transfer. Never reactivate archived goods.
create function public.super_transfer_stock_to_unit(p_id uuid,p_source uuid,p_unit uuid,p_qty integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.product_variants%rowtype; p public.products%rowtype; t public.product_variants%rowtype;
 previous public.stock_transfers%rowtype; destination uuid; category uuid; c public.categories%rowtype;
begin
 if not public.is_super_admin() then raise exception 'not_super_admin'; end if;
 if p_id is null or p_source is null or p_unit is null or p_qty is null or p_qty<=0 then raise exception 'invalid_transfer'; end if;
 select * into s from public.product_variants where id=p_source;
 if not found or s.unit_id is distinct from public.current_unit_id() then raise exception 'Выберите товар текущего БЮ'; end if;
 if p_unit=s.unit_id or not exists(select 1 from public.business_units where id=p_unit) then raise exception 'Выберите другой БЮ'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into previous from public.stock_transfers where id=p_id;
 if found then
  if previous.source_variant<>p_source or previous.qty<>p_qty or not exists(select 1 from public.product_variants where id=previous.target_variant and unit_id=p_unit) then raise exception 'transfer_request_changed'; end if;
  return jsonb_build_object('ok',true,'already_applied',true);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('unit-stock:'||s.product_id::text||':'||p_unit::text,0));
 select * into p from public.products where id=s.product_id for share;
 if not p.is_active or not s.is_active then raise exception 'Товар отключён или находится в архиве'; end if;
 select * into t from public.product_variants where unit_id=p_unit and stock_family_id=s.stock_family_id;
 if found then
  if not t.is_active or not exists(select 1 from public.products where id=t.product_id and is_active) then raise exception 'В БЮ назначения товар находится в архиве или вариант отключён'; end if;
 else
  select target.product_id into destination from public.product_variants source
   join public.product_variants target on target.stock_family_id=source.stock_family_id and target.unit_id=p_unit
   where source.product_id=s.product_id order by target.created_at,target.id limit 1;
  if destination is not null and not exists(select 1 from public.products where id=destination and is_active) then raise exception 'В БЮ назначения товар находится в архиве'; end if;
  if destination is null then
   if p.category_id is not null then
    select * into c from public.categories where id=p.category_id;
    insert into public.categories(unit_id,name,sort) values(p_unit,c.name,c.sort) on conflict(unit_id,name) do nothing;
    select id into category from public.categories where unit_id=p_unit and name=c.name;
   end if;
   insert into public.products(unit_id,name,description,material,category_id,image_url,images,placement)
    values(p_unit,p.name,p.description,p.material,category,p.image_url,p.images,p.placement) returning id into destination;
  end if;
  if s.sku is not null and exists(select 1 from public.product_variants where unit_id=p_unit and sku=s.sku) then raise exception 'В БЮ назначения этот SKU уже занят другим товаром'; end if;
  insert into public.product_variants(unit_id,product_id,size,color,sku,stock_family_id,low_stock_threshold)
   values(p_unit,destination,s.size,s.color,s.sku,s.stock_family_id,s.low_stock_threshold) returning * into t;
 end if;
 return public.super_transfer_stock(p_id,p_source,t.id,p_qty);
end; $$;
revoke all on function public.super_transfer_stock_to_unit(uuid,uuid,uuid,integer) from public,anon;
grant execute on function public.super_transfer_stock_to_unit(uuid,uuid,uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
