begin;
alter table public.product_variants add column low_stock_threshold integer not null default 5
 check(low_stock_threshold between 0 and 1000000);
-- Existing column-level grants protect stock quantities. RLS restricts this
-- additional editable setting to active administrators.
grant update(low_stock_threshold) on public.product_variants to authenticated;
create index orders_received_report_idx on public.orders(received_at) where status='received';

create function public.admin_stock_report(p_query text default '') returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'not_admin'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(s) order by s.product_name,s.size,s.color,s.variant_id),'[]'::jsonb)
 from (select v.id variant_id,p.id product_id,p.name product_name,p.placement,
 v.size,v.color,v.sku,v.total_qty,v.reserved_qty,
 greatest(0,v.total_qty-v.reserved_qty) available_qty,v.low_stock_threshold,
 greatest(0,v.total_qty-v.reserved_qty)<=v.low_stock_threshold alert
 from public.products p join public.product_variants v on v.product_id=p.id
 where p.is_active and v.is_active
 and position(lower(btrim(coalesce(p_query,''))) in lower(concat_ws(' ',p.name,v.size,v.color,v.sku)))>0) s);
end; $$;

create function public.admin_handout_report(
 p_from date,p_until date,p_scope text default 'all',p_mode text default 'all',p_query text default ''
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'not_admin'; end if;
 if p_from is null or p_until is null or not isfinite(p_from) or not isfinite(p_until)
 or p_from>p_until or p_until>='9999-12-31'::date then raise exception 'invalid_report_period'; end if;
 if p_scope is null or p_scope not in ('all','catalog','welcome')
 or p_mode is null or p_mode not in ('all','office','remote_visit','remote_shipping') then raise exception 'invalid_report_filter'; end if;
 return (with lines as materialized (
 select o.id order_id,o.order_number,o.order_scope,o.received_at,o.received_by_name,
 coalesce(o.fulfillment_mode,case when o.is_remote then 'remote_shipping' else 'office' end) fulfillment_mode,
 (o.received_at at time zone 'Asia/Tashkent')::date received_day,
 i.product_id,i.variant_id,i.product_name,i.size,i.color,i.sku,i.qty
 from public.orders o join public.order_items i on i.order_id=o.id
 where o.status='received'
 and o.received_at >= (p_from::timestamp at time zone 'Asia/Tashkent')
 and o.received_at < ((p_until+1)::timestamp at time zone 'Asia/Tashkent')
 and (p_scope='all' or o.order_scope=p_scope)
 and (p_mode='all' or coalesce(o.fulfillment_mode,case when o.is_remote then 'remote_shipping' else 'office' end)=p_mode)
 and position(lower(btrim(coalesce(p_query,''))) in lower(concat_ws(' ',i.product_name,i.size,i.color,i.sku)))>0
 ), items as (
 select product_id,variant_id,product_name,size,color,sku,sum(qty) qty,count(distinct order_id) orders
 from lines group by product_id,variant_id,product_name,size,color,sku
 ), days as (
 select received_day as "day",count(distinct order_id) orders,sum(qty) qty from lines group by received_day
 ) select jsonb_build_object(
 'order_count',(select count(distinct order_id) from lines),
 'units',coalesce((select sum(qty) from lines),0),
 'items',coalesce((select jsonb_agg(to_jsonb(items) order by qty desc,product_name,size,color,variant_id) from items),'[]'::jsonb),
 'days',coalesce((select jsonb_agg(to_jsonb(days) order by "day") from days),'[]'::jsonb),
 'details',coalesce((select jsonb_agg(to_jsonb(lines) order by received_at desc,order_id,variant_id) from lines),'[]'::jsonb)
 ));
end; $$;
revoke all on function public.admin_stock_report(text),public.admin_handout_report(date,date,text,text,text) from public,anon;
grant execute on function public.admin_stock_report(text),public.admin_handout_report(date,date,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
