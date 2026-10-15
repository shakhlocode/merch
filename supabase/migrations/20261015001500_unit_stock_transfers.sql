begin;
create table public.stock_transfers (
 id uuid primary key,source_variant uuid not null references public.product_variants(id),
 target_variant uuid not null references public.product_variants(id),qty integer not null check(qty>0),
 actor_id uuid not null references public.employees(id),created_at timestamptz not null default now()
);
alter table public.stock_transfers enable row level security;
grant select on public.stock_transfers to authenticated;
create policy transfer_read on public.stock_transfers for select to authenticated using(public.is_super_admin());
create function public.super_stock_overview() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_super_admin() then raise exception 'not_super_admin'; end if;
 return jsonb_build_object('variants',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'unit_id',v.unit_id,'family',v.stock_family_id,'name',p.name,'size',v.size,'color',v.color,'sku',v.sku,'total',v.total_qty,'reserved',v.reserved_qty,'available',v.total_qty-v.reserved_qty) order by p.name,v.size,v.color,v.unit_id)
 from public.product_variants v join public.products p on p.id=v.product_id where p.is_active and v.is_active),'[]'),
 'transfers',coalesce((select jsonb_agg(to_jsonb(t)) from (select * from public.stock_transfers order by created_at desc limit 100) t),'[]'));
end; $$;
create function public.super_transfer_stock(p_id uuid,p_source uuid,p_target uuid,p_qty integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.product_variants%rowtype; t public.product_variants%rowtype; previous public.stock_transfers%rowtype;
begin
 if not public.is_super_admin() then raise exception 'not_super_admin'; end if;
 if p_id is null or p_source is null or p_target is null or p_qty is null or p_qty<=0 then raise exception 'invalid_transfer'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into previous from public.stock_transfers where id=p_id;
 if found then
  if previous.source_variant<>p_source or previous.target_variant<>p_target or previous.qty<>p_qty then raise exception 'transfer_request_changed'; end if;
  return jsonb_build_object('ok',true,'already_applied',true);
 end if;
 -- Deterministic locking also serializes a transfer with reservation/issue.
 perform id from public.product_variants where id in(p_source,p_target) order by id for update;
 select * into s from public.product_variants where id=p_source;
 select * into t from public.product_variants where id=p_target;
 if s.id is null or t.id is null or s.unit_id=t.unit_id or s.stock_family_id<>t.stock_family_id or not s.is_active or not t.is_active
 or not exists(select 1 from public.products where id=s.product_id and is_active) or not exists(select 1 from public.products where id=t.product_id and is_active) then raise exception 'invalid_transfer'; end if;
 if s.total_qty-s.reserved_qty<p_qty then raise exception 'Недостаточно свободного остатка. Зарезервированный товар переносить нельзя'; end if;
 insert into public.stock_transfers values(p_id,s.id,t.id,p_qty,auth.uid(),now());
 insert into public.stock_movements(unit_id,variant_id,movement_type,qty,created_by,comment) values
 (s.unit_id,s.id,'write_off',-p_qty,auth.uid(),'Перенос между складами: '||p_id),
 (t.unit_id,t.id,'income',p_qty,auth.uid(),'Перенос между складами: '||p_id);
 return jsonb_build_object('ok',true,'already_applied',false);
end; $$;
revoke all on function public.super_stock_overview(),public.super_transfer_stock(uuid,uuid,uuid,integer) from public,anon;
grant execute on function public.super_stock_overview(),public.super_transfer_stock(uuid,uuid,uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
