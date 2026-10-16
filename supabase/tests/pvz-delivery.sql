\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAILED: %',label;end if;raise notice 'PASS: %',label;end $$;
grant execute on function pg_temp.assert(boolean,text) to authenticated;
insert into public.employee_directory(id,email,full_name,external_id) values
 ('b1000000-0000-4000-8000-000000000001','pvz-admin@example.test','PVZ admin','PVZ-ADMIN'),
 ('b1000000-0000-4000-8000-000000000002','pending-pvz@no-mail.merch.invalid','PVZ guest','PVZ-GUEST'),
 ('b1000000-0000-4000-8000-000000000003','pvz-mail@example.test','Email buyer','PVZ-MAIL');
insert into auth.users(id,email,email_confirmed_at) values
 ('b0000000-0000-4000-8000-000000000001','pvz-admin@example.test',now()),
 ('b0000000-0000-4000-8000-000000000002','i-b4000000-0000-4000-8000-000000000001@guest.merch.invalid',now()),
 ('b0000000-0000-4000-8000-000000000003','pvz-mail@example.test',now());
update public.employees set is_active=true where id in('b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000003');
insert into public.shop_admins values('pvz-admin@example.test','10000000-0000-4000-8000-000000000002');
insert into public.products(id,name) values('b2000000-0000-4000-8000-000000000001','PVZ product');
insert into public.product_variants(id,product_id,sku) values('b3000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','PVZ-ITEM');
insert into public.stock_movements(variant_id,movement_type,qty) values('b3000000-0000-4000-8000-000000000001','income',10);
select set_config('request.jwt.claim.sub','b0000000-0000-4000-8000-000000000001',true);
select set_config('request.headers','{"x-merch-unit":"10000000-0000-4000-8000-000000000002"}',true);
select set_config('test.pvzchoice',(select id::text from public.fulfillment_choices where mode='pvz' and unit_id='10000000-0000-4000-8000-000000000002'),true);
set local role authenticated;
select public.admin_create_invitation('b4000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002',repeat('1',64),repeat('2',64),'code','catalog');
reset role;
select public.claim_invitation('b4000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002',repeat('2',64));
set local role authenticated;
select set_config('request.jwt.claim.sub','b0000000-0000-4000-8000-000000000003',true);
select pg_temp.assert(not public.can_use_pvz() and (select count(*)=0 from public.fulfillment_choices where mode='pvz'),'email account cannot see PVZ choice');
do $$ begin
 begin perform public.create_merch_order_v4('[{"variant_id":"b3000000-0000-4000-8000-000000000001","qty":1}]','pvz',null,'+998901234567',null,null,null,null,null,current_setting('test.pvzchoice')::uuid,'000123');raise exception 'EXPECTED_DENIAL_MISSING';exception when others then if sqlerrm<>'pvz_identifier_only' then raise;end if;end;
 begin insert into public.orders(employee_id,delivery_type,fulfillment_mode,is_remote,pvz_code) values('b0000000-0000-4000-8000-000000000003','pvz','pvz',true,'000123');raise exception 'EXPECTED_DENIAL_MISSING';exception when others then if sqlerrm<>'pvz_identifier_only' and sqlstate<>'42501' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','b0000000-0000-4000-8000-000000000002',true);
select pg_temp.assert(public.can_use_pvz() and (select count(*)=1 from public.fulfillment_choices where mode='pvz'),'claimed identifier account can see PVZ choice');
do $$ begin
 begin perform public.create_merch_order_v4('[{"variant_id":"b3000000-0000-4000-8000-000000000001","qty":1}]','pvz',null,'+998901234567',null,null,null,null,null,current_setting('test.pvzchoice')::uuid,'   ');raise exception 'EXPECTED_DENIAL_MISSING';exception when others then if sqlerrm<>'invalid_pvz_code' then raise;end if;end;
end $$;
select pg_temp.assert((select reserved_qty=0 from public.product_variants where sku='PVZ-ITEM'),'denied PVZ attempts do not reserve inventory');
select public.create_merch_order_v4('[{"variant_id":"b3000000-0000-4000-8000-000000000001","qty":1}]','pvz',null,'+998901234567',null,null,null,null,null,current_setting('test.pvzchoice')::uuid,'000123');
select pg_temp.assert((select is_remote and pickup_code is null and pvz_code='000123' and delivery_type='pvz' and fulfillment_mode='pvz' from public.orders),'PVZ code keeps leading zeroes and creates shipment without receipt QR');
select pg_temp.assert((select reserved_qty=1 and total_qty=10 from public.product_variants where sku='PVZ-ITEM'),'PVZ order uses normal reservation');
select set_config('request.jwt.claim.sub','b0000000-0000-4000-8000-000000000001',true);
select public.admin_save_order((select id from public.orders),'shipped',(select version from public.orders),null,null,null,'b0000000-0000-4000-8000-000000000001');
select pg_temp.assert((select status='shipped' from public.orders) and (select reserved_qty=0 and total_qty=9 from public.product_variants where sku='PVZ-ITEM'),'administrator ships PVZ order without QR and stock is written off once');
rollback;
