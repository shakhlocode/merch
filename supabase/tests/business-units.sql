\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAILED: %',label; end if;raise notice 'PASS: %',label;end $$;
grant execute on function pg_temp.assert(boolean,text) to authenticated,service_role;
insert into public.employee_directory(unit_id,email,full_name,business_unit,legal_entity,external_id) values
 ('10000000-0000-4000-8000-000000000001','units-fin@example.test','Fin buyer','Ecom HR','Other legal entity','UNIT-FIN'),
 ('10000000-0000-4000-8000-000000000002','units-ecom@example.test','Ecom buyer','Fintech HR','Another entity','UNIT-ECOM');
insert into public.shop_admins values('units-admin@example.test','10000000-0000-4000-8000-000000000001');
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000001','units-fin@example.test'),
 ('00000000-0000-4000-8000-000000000002','units-ecom@example.test'),
 ('00000000-0000-4000-8000-000000000003','units-admin@example.test'),
 ('00000000-0000-4000-8000-000000000004','shahlo.kham@gmail.com');
insert into public.products(id,unit_id,name) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Units shirt'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','Units shirt');
insert into public.product_variants(id,unit_id,product_id,size,color,sku,stock_family_id) values
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','M','Purple','SHARED-SKU','40000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','M','Purple','SHARED-SKU','40000000-0000-4000-8000-000000000001');
insert into public.stock_movements(unit_id,variant_id,movement_type,qty) values
 ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','income',5),
 ('10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','income',10);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.assert(public.current_unit_id()='10000000-0000-4000-8000-000000000001','directory grant determines the single shop, independently of HR business unit/legal entity');
select pg_temp.assert((select count(*)=1 from public.product_variants where sku='SHARED-SKU'),'employee sees only own shop variant and stock');
select public.create_merch_order_v3('[{"variant_id":"30000000-0000-4000-8000-000000000001","qty":1}]','office',(select id from public.pickup_offices limit 1),'+998901234567',null,null,null,null,null,null);
select set_config('test.finorder',(select id::text from public.orders),true);
select set_config('test.fincode',(select pickup_code from public.orders),true);
do $$ begin
 begin perform public.create_merch_order('[{"variant_id":"30000000-0000-4000-8000-000000000002","qty":1}]','office',null,null,null,false,null);raise exception 'EXPECTED_DENIAL_MISSING';
 exception when others then if sqlerrm<>'product_is_not_available' then raise;end if;end;
end $$;
select set_config('request.headers','{"x-merch-unit":"10000000-0000-4000-8000-000000000002"}',true);
select pg_temp.assert(public.current_unit_id() is null and not public.has_system_access() and (select count(*)=0 from public.products),'spoofed unit header cannot open a second shop');
select set_config('request.headers','{}',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select public.create_merch_order('[{"variant_id":"30000000-0000-4000-8000-000000000002","qty":1}]','office',null,null,null,false,null);
select set_config('test.ecomorder',(select id::text from public.orders),true);
select set_config('test.ecomcode',(select pickup_code from public.orders),true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select pg_temp.assert(public.is_admin() and not public.is_super_admin(),'pending email role activates at registration without a customer registry row');
select pg_temp.assert((select count(*)=1 from public.orders) and (select count(*)=1 from public.employee_directory),'unit admin reads only own orders and employee registry');
select pg_temp.assert((select count(*)=2 from public.admin_shop_contacts()),'assignee picker lists only eligible unit admins/superadmins');
do $$ begin
 begin perform public.admin_issue_order(current_setting('test.ecomcode'));raise exception 'EXPECTED_DENIAL_MISSING';exception when others then if sqlerrm<>'pickup_not_found' then raise;end if;end;
 begin perform public.admin_update_order(current_setting('test.ecomorder')::uuid,'ready',null,null);raise exception 'EXPECTED_DENIAL_MISSING';exception when others then if sqlerrm<>'order_not_found' then raise;end if;end;
 begin perform public.super_set_admin('friend@example.test','10000000-0000-4000-8000-000000000002',false,true);raise exception 'EXPECTED_DENIAL_MISSING';exception when others then if sqlerrm<>'not_super_admin' then raise;end if;end;
 begin update public.employees set is_admin=true where id=auth.uid();raise exception 'EXPECTED_DENIAL_MISSING';exception when insufficient_privilege then null;end;
 begin insert into public.shop_admins values('friend@example.test','10000000-0000-4000-8000-000000000002');raise exception 'EXPECTED_DENIAL_MISSING';exception when insufficient_privilege then null;end;
 begin update public.products set unit_id='10000000-0000-4000-8000-000000000002' where id='20000000-0000-4000-8000-000000000001';raise exception 'EXPECTED_DENIAL_MISSING';exception when others then if sqlerrm<>'unit_is_immutable' then raise;end if;end;
 begin perform public.admin_save_order(current_setting('test.finorder')::uuid,'ready',0,null,null,null,'00000000-0000-4000-8000-000000000002');raise exception 'EXPECTED_DENIAL_MISSING';exception when others then if sqlerrm<>'contact_not_admin' then raise;end if;end;
end $$;
select pg_temp.assert((select jsonb_array_length(public.admin_stock_report())=1),'stock analytics do not include another unit');
update public.merch_settings set catalog_rules='Fintech rules only' where id=1;
select public.admin_update_order(current_setting('test.finorder')::uuid,'ready',null,null);
select public.admin_issue_order(current_setting('test.fincode'));
select pg_temp.assert((public.admin_issue_order(current_setting('test.fincode'))->>'already_issued')::boolean,'unit scanner issues once and duplicate scan is safe');
select pg_temp.assert(public.admin_handout_report((now() at time zone 'Asia/Tashkent')::date,(now() at time zone 'Asia/Tashkent')::date)->>'units'='1','receipt report is isolated by unit');
select set_config('request.headers','{"x-merch-unit":"10000000-0000-4000-8000-000000000002"}',true);
select pg_temp.assert(not public.is_admin() and (select count(*)=0 from public.orders),'unit admin cannot switch to an unassigned unit');
select set_config('request.headers','{}',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select pg_temp.assert(public.is_super_admin(),'owner is superadmin');
select pg_temp.assert((public.my_shop_context()->'units')::jsonb @> '[{"slug":"fintech"},{"slug":"ecom"},{"slug":"technologies"}]','superadmin can switch all three shops');
select pg_temp.assert((select catalog_rules<>'Fintech rules only' from public.merch_settings),'unit texts remain independent');
select public.super_transfer_stock('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001',3);
select pg_temp.assert((public.super_transfer_stock('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001',3)->>'already_applied')::boolean,'stock transfer is idempotent');
do $$ begin
 begin perform public.super_transfer_stock(gen_random_uuid(),'30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001',7);raise exception 'EXPECTED_DENIAL_MISSING';exception when others then if sqlerrm not like 'Недостаточно свободного остатка%' then raise;end if;end;
end $$;
-- Personal Welcome links carry their unit through activation without email.
reset role;
select set_config('request.headers','{}',true);
insert into public.employee_directory(id,unit_id,email,full_name,external_id) values
 ('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','units-invite@example.test','New joiner','NEW-UNIT');
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000005','i-70000000-0000-4000-8000-000000000001@guest.merch.invalid');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select public.admin_create_invitation('70000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',repeat('7',64),repeat('8',64),'code','welcome');
select pg_temp.assert((select count(*)=1 from public.employee_invitations),'unit admin creates only a current-shop invitation');
set local role service_role;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.assert((public.check_invitation_code(repeat('7',64),repeat('8',64))->>'ok')::boolean,'service verifies code without needing a preselected shop');
select pg_temp.assert(public.claim_invitation('70000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005',repeat('8',64))->>'next'='/welcome?unit=10000000-0000-4000-8000-000000000001','Welcome activation redirects into the invitation unit');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000005',true);
select set_config('request.headers','{}',true);
select pg_temp.assert(public.current_unit_id()='10000000-0000-4000-8000-000000000001' and public.my_store_scope()='welcome','claimed guest receives exactly the invited unit and scope');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select public.super_set_admin('units-admin@example.test','10000000-0000-4000-8000-000000000001',false,false);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select pg_temp.assert(not public.is_admin(),'role revocation takes effect for existing sessions');
reset role;
select pg_temp.assert((select sum(total_qty)=14 and sum(reserved_qty)=1 from public.product_variants where sku='SHARED-SKU'),'transfers preserve physical total and outstanding reservations after one issue');
select pg_temp.assert((select count(*)=1 from public.stock_transfers),'retries record one transfer');
select pg_temp.assert((select total_qty=7 and reserved_qty=1 from public.product_variants where id='30000000-0000-4000-8000-000000000002'),'transfer does not consume a reserved item');
-- Global uniqueness preserves the one-shop rule even across concurrent imports.
do $$ begin
 begin insert into public.employee_directory(unit_id,email,full_name) values('10000000-0000-4000-8000-000000000003','units-fin@example.test','Duplicate grant');raise exception 'EXPECTED_DENIAL_MISSING';exception when unique_violation then null;end;
end $$;
rollback;
