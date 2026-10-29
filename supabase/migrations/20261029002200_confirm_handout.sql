-- Scanning only reads order details. Confirmation keeps the existing atomic issue operation.
begin;
create function public.admin_lookup_pickup(p_code text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare o public.orders%rowtype;
begin
 if not public.is_admin() then raise exception 'not_admin'; end if;
 if p_code is null or p_code !~ '^[0-9]{20}$' then raise exception 'invalid_pickup_code'; end if;
 select * into o from public.orders where pickup_code=p_code and unit_id=public.current_unit_id();
 if not found or o.is_remote then raise exception 'pickup_not_found'; end if;
 return jsonb_build_object('order_id',o.id,'order_number',o.order_number,'version',o.version,
  'status',o.status,'can_issue',o.status='ready' and o.pickup_status='packed',
  'recipient',o.full_name,'storage_location',o.storage_location,
  'already_issued',o.status='received','received_at',o.received_at,'issued_by_name',o.received_by_name,
  'items',coalesce((select jsonb_agg(jsonb_build_object('name',i.product_name,'size',i.size,'color',i.color,'qty',i.qty) order by i.id)
   from public.order_items i where i.order_id=o.id),'[]'::jsonb));
end; $$;

create function public.admin_confirm_pickup(p_code text,p_order_id uuid,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype;
begin
 if not public.is_admin() then raise exception 'not_admin'; end if;
 if p_code is null or p_code !~ '^[0-9]{20}$' then raise exception 'invalid_pickup_code'; end if;
 select * into o from public.orders where pickup_code=p_code and id=p_order_id and unit_id=public.current_unit_id() for update;
 if not found or o.is_remote then raise exception 'pickup_not_found'; end if;
 -- Repeated confirmations return the original receipt, including concurrent clicks.
 if o.status<>'received' and (p_expected_version is null or p_expected_version<>o.version) then raise exception 'order_changed'; end if;
 return public.admin_issue_order(p_code);
end; $$;

alter function public.admin_lookup_pickup(text) owner to merch_executor;
alter function public.admin_confirm_pickup(text,uuid,integer) owner to merch_executor;
revoke all on function public.admin_lookup_pickup(text),public.admin_confirm_pickup(text,uuid,integer) from public,anon;
grant execute on function public.admin_lookup_pickup(text),public.admin_confirm_pickup(text,uuid,integer) to authenticated;
commit;
