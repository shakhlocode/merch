\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAILED: %',label;end if;raise notice 'PASS: %',label;end$$;
grant execute on function pg_temp.assert(boolean,text) to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000090','shahlo.kham@gmail.com');
insert into public.products(id,name,description,placement) values('10000000-0000-4000-8000-000000000090','Transfer-only new product','Optional description','both');
insert into public.product_variants(id,product_id,size,color,sku) values
 ('20000000-0000-4000-8000-000000000090','10000000-0000-4000-8000-000000000090','M','Black','TRANSFER-M'),
 ('20000000-0000-4000-8000-000000000091','10000000-0000-4000-8000-000000000090','L','Black','TRANSFER-L');
insert into public.stock_movements(variant_id,movement_type,qty) values
 ('20000000-0000-4000-8000-000000000090','income',10),('20000000-0000-4000-8000-000000000091','income',4),
 ('20000000-0000-4000-8000-000000000090','reserve',-2);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000090',true);
select public.super_transfer_stock_to_unit('30000000-0000-4000-8000-000000000090','20000000-0000-4000-8000-000000000090','10000000-0000-4000-8000-000000000001',3);
select pg_temp.assert((public.super_transfer_stock_to_unit('30000000-0000-4000-8000-000000000090','20000000-0000-4000-8000-000000000090','10000000-0000-4000-8000-000000000001',3)->>'already_applied')::boolean,'BU transfer retries do not copy a card or deduct twice');
select pg_temp.assert((select total_qty=7 and reserved_qty=2 from public.product_variants where sku='TRANSFER-M'),'transfer only uses free stock from the selected unit');
select public.super_transfer_stock_to_unit('30000000-0000-4000-8000-000000000091','20000000-0000-4000-8000-000000000091','10000000-0000-4000-8000-000000000001',1);
do $$begin
 begin perform public.super_transfer_stock_to_unit(gen_random_uuid(),'20000000-0000-4000-8000-000000000090','10000000-0000-4000-8000-000000000003',9);raise exception 'EXPECTED_DENIAL_MISSING';exception when others then if sqlerrm not like 'Недостаточно свободного остатка%' then raise;end if;end;
end$$;
select set_config('request.headers','{"x-merch-unit":"10000000-0000-4000-8000-000000000001"}',true);
select pg_temp.assert((select count(*)=1 from public.products where name='Transfer-only new product'),'further sizes reuse the destination product card');
select pg_temp.assert((select count(*)=2 and sum(total_qty)=4 and sum(reserved_qty)=0 from public.product_variants where sku in('TRANSFER-M','TRANSFER-L')),'destination receives correct size/color quantities without copying reservations');
do $$begin
 begin perform public.super_transfer_stock_to_unit(gen_random_uuid(),'20000000-0000-4000-8000-000000000090','10000000-0000-4000-8000-000000000003',1);raise exception 'EXPECTED_DENIAL_MISSING';exception when others then if sqlerrm<>'Выберите товар текущего БЮ' then raise;end if;end;
end$$;
update public.products set is_active=false where name='Transfer-only new product';
select set_config('request.headers','{}',true);
do $$begin
 begin perform public.super_transfer_stock_to_unit(gen_random_uuid(),'20000000-0000-4000-8000-000000000090','10000000-0000-4000-8000-000000000001',1);raise exception 'EXPECTED_DENIAL_MISSING';exception when others then if sqlerrm<>'В БЮ назначения товар находится в архиве или вариант отключён' then raise;end if;end;
end$$;
reset role;
select pg_temp.assert((select sum(total_qty)=14 and sum(reserved_qty)=2 from public.product_variants where sku in('TRANSFER-M','TRANSFER-L')),'total physical stock and reservations remain unchanged across BU transfers');
select pg_temp.assert((select count(*)=0 from public.products where name='Transfer-only new product' and unit_id='10000000-0000-4000-8000-000000000003'),'failed transfer rolls back automatically created destination card and variant');
select pg_temp.assert((select count(*)=2 from public.stock_transfers),'one journal entry per completed transfer');
rollback;
