\set ON_ERROR_STOP on
begin;
insert into public.employee_directory(email,full_name,hired_at) values
 ('admin@example.test','Test admin',current_date-interval '1 year'),
 ('employee@example.test','Test employee',current_date-interval '1 year'),
 ('new@example.test','New employee',current_date);
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-000000000001','admin@example.test'),
 ('00000000-0000-0000-0000-000000000002','employee@example.test'),
 ('00000000-0000-0000-0000-000000000003','new@example.test'),
 ('00000000-0000-0000-0000-000000000004','outsider@example.test');
update public.employees set is_admin=true where email='admin@example.test';
insert into public.shop_admins(email,unit_id) select lower(email),'10000000-0000-4000-8000-000000000002'::uuid from public.employees where is_admin on conflict do nothing;
insert into public.products(id,name) values
 ('10000000-0000-0000-0000-000000000001','Test shirt'),
 ('10000000-0000-0000-0000-000000000002','Test bottle'),
 ('10000000-0000-0000-0000-000000000003','Inactive product');
update public.products set is_active=false where name='Inactive product';
insert into public.product_variants(id,product_id,sku) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','TEST-SHIRT'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','TEST-SHIRT-L'),
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','TEST-BOTTLE'),
 ('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000003','TEST-INACTIVE');
insert into public.stock_movements(variant_id,movement_type,qty) select id,'income',5 from public.product_variants;

create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAILED: %',label; end if; raise notice 'PASS: %',label; end $$;
grant execute on function pg_temp.assert(boolean,text) to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select pg_temp.assert((select count(*)=1 from public.employees),'employee can only read own profile');
select pg_temp.assert((select count(*)=0 from public.employee_directory),'HR directory is private');
select pg_temp.assert((select count(*)=3 from public.product_variants),'inactive products are hidden');
select pg_temp.assert((select is_allowed from public.get_employee_merch_access('employee@example.test')),'active directory eligibility');
select public.update_my_profile('Updated employee','123',null,null,'Tashkent',null);
select public.mark_password_set();
select pg_temp.assert((select password_set_at is not null and full_name='Updated employee' from public.employees),'profile and password setup');
do $$ begin
  begin perform public.get_employee_merch_access('admin@example.test'); raise exception 'EXPECTED_DENIAL_MISSING';
  exception when others then if sqlerrm <> 'not_allowed' then raise; end if; end;
end $$;
select pg_temp.assert(not has_table_privilege('authenticated','public.orders','INSERT'),'orders cannot bypass checkout RPC');
select pg_temp.assert(not has_function_privilege('anon','public.create_merch_order(jsonb,public.delivery_type,text,text,text,boolean,text)','EXECUTE'),'anonymous checkout denied');
do $$ begin
  begin perform public.admin_update_order(gen_random_uuid(),'confirmed',null,null); raise exception 'EXPECTED_DENIAL_MISSING';
  exception when others then if sqlerrm <> 'not_admin' then raise; end if; end;
end $$;
do $$ begin
  begin perform public.create_merch_order('[{"variant_id":"20000000-0000-0000-0000-000000000001","qty":2}]','office',null,null,null,false,null);
    raise exception 'EXPECTED_DENIAL_MISSING';
  exception when others then if sqlerrm <> 'one_unit_per_product_only' then raise; end if; end;
  begin perform public.create_merch_order('[{"variant_id":"20000000-0000-0000-0000-000000000001","qty":1},{"variant_id":"20000000-0000-0000-0000-000000000002","qty":1}]','office',null,null,null,false,null);
    raise exception 'EXPECTED_DENIAL_MISSING';
  exception when others then if sqlerrm <> 'one_variant_per_product_only' then raise; end if; end;
  begin perform public.create_merch_order('[{"variant_id":"20000000-0000-0000-0000-000000000004","qty":1}]','office',null,null,null,false,null);
    raise exception 'EXPECTED_DENIAL_MISSING';
  exception when others then if sqlerrm <> 'product_is_not_available' then raise; end if; end;
end $$;
select pg_temp.assert((select count(*)=0 from public.orders),'invalid orders leave no partial rows');
select public.create_merch_order('[{"variant_id":"20000000-0000-0000-0000-000000000001","qty":1}]','office','Test address','123','Test',true,'Uzbekistan');
select pg_temp.assert((select reserved_qty=1 and total_qty=5 from public.product_variants where sku='TEST-SHIRT'),'order reserves stock');
select pg_temp.assert((select order_number like 'MERCH-%' and is_remote and country='Uzbekistan' from public.orders),'order number and remote fields');
select pg_temp.assert((select count(*)=1 from public.order_items),'order items readable by owner');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
select pg_temp.assert((select count(*)=0 from public.orders),'another employee cannot read orders');
select pg_temp.assert((select is_allowed from public.get_employee_merch_access('new@example.test')),'active directory membership grants access regardless of tenure');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
do $$ begin
  begin perform public.create_merch_order('[{"variant_id":"20000000-0000-0000-0000-000000000001","qty":1}]','office',null,null,null,false,null);
    raise exception 'EXPECTED_DENIAL_MISSING';
  exception when others then if sqlerrm <> 'employee_not_allowed' then raise; end if; end;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select pg_temp.assert((select count(*)=3 from public.employees where email in ('admin@example.test','employee@example.test','new@example.test','outsider@example.test')),'unit admin sees only registered employee profiles');
select public.admin_update_order((select id from public.orders limit 1),'confirmed','Checked',null);
select public.admin_update_order((select id from public.orders limit 1),'shipped','Sent','TEST-TRACK');
select pg_temp.assert((select total_qty=4 and reserved_qty=0 from public.product_variants where sku='TEST-SHIRT'),'shipping writes off reservation');
select public.admin_update_order((select id from public.orders limit 1),'shipped','Sent again','TEST-TRACK');
select pg_temp.assert((select total_qty=4 from public.product_variants where sku='TEST-SHIRT'),'repeated status does not double-write stock');
select public.admin_update_order((select id from public.orders limit 1),'cancelled',null,null);
select pg_temp.assert((select total_qty=5 and reserved_qty=0 from public.product_variants where sku='TEST-SHIRT'),'shipped cancellation returns stock');
do $$ begin
  begin perform public.admin_update_order((select id from public.orders limit 1),'new',null,null); raise exception 'EXPECTED_DENIAL_MISSING';
  exception when others then if sqlerrm <> 'terminal_order_cannot_reopen' then raise; end if; end;
end $$;
select public.admin_set_order_handout((select id from public.orders limit 1),'Shelf A','refused',null);
select pg_temp.assert((select storage_location='Shelf A' from public.orders),'handout fields');
insert into storage.objects(bucket_id,name) values('merch-products','10000000-0000-4000-8000-000000000002/test.jpg');
select pg_temp.assert((select count(*)=1 from storage.objects),'admin can upload images');
update public.employee_directory set full_name='HR updated name' where email='employee@example.test';
select pg_temp.assert((select full_name='HR updated name' from public.employees where email='employee@example.test'),'HR sync updates profile');
select pg_temp.assert((select count(*)=1 from public.employee_audit_log where actor_id=auth.uid() and action='update'),'HR changes audited');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
do $$ begin
  begin insert into storage.objects(bucket_id,name) values('merch-products','denied.jpg'); raise exception 'EXPECTED_DENIAL_MISSING';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.assert((select count(*)=23 from pg_tables where schemaname='public'),'all business tables including unit membership, transfer history and browser revocations installed');
rollback;
