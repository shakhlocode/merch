\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAILED: %',label; end if; raise notice 'PASS: %',label; end $$;
grant execute on function pg_temp.assert(boolean,text) to authenticated;
insert into public.employee_directory(email,full_name,access_mode,access_expires_at) values
 ('a-admin@example.test','Access admin','unlimited',null),
 ('a-once@example.test','Once employee','one_order',null),
 ('a-expired@example.test','Expired employee','until_date',now()-interval '1 second'),
 ('a-period@example.test','Period employee','until_date',now()+interval '1 day');
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-000000000041','a-admin@example.test'),
 ('00000000-0000-0000-0000-000000000042','a-once@example.test'),
 ('00000000-0000-0000-0000-000000000043','a-expired@example.test'),
 ('00000000-0000-0000-0000-000000000044','a-period@example.test');
update public.employees set is_admin=true where email='a-admin@example.test';
insert into public.shop_admins(email,unit_id) select lower(email),'10000000-0000-4000-8000-000000000002'::uuid from public.employees where is_admin on conflict do nothing;
insert into public.products(id,name) values('10000000-0000-0000-0000-000000000041','Access shirt'),('10000000-0000-0000-0000-000000000042','Access bottle');
insert into public.product_variants(id,product_id,sku) values
 ('20000000-0000-0000-0000-000000000041','10000000-0000-0000-0000-000000000041','A-SHIRT'),
 ('20000000-0000-0000-0000-000000000042','10000000-0000-0000-0000-000000000042','A-BOTTLE');
insert into public.stock_movements(variant_id,movement_type,qty) select id,'income',5 from public.product_variants where sku in ('A-SHIRT','A-BOTTLE');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000043',true);
select pg_temp.assert(not public.has_system_access() and (select reason='access_expired' from public.get_employee_merch_access('a-expired@example.test')),'expired access denied at database');
select pg_temp.assert(not exists(select 1 from public.products where name='Access shirt'),'expired session cannot read catalog');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000044',true);
select pg_temp.assert(public.has_system_access(),'valid period grants access');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000042',true);
select public.create_merch_order('[{"variant_id":"20000000-0000-0000-0000-000000000041","qty":1}]','office',null,null,null,false,null);
do $$ begin
 begin perform public.create_merch_order('[{"variant_id":"20000000-0000-0000-0000-000000000042","qty":1}]','office',null,null,null,false,null); raise exception 'MISSING_DENIAL'; exception when others then if sqlerrm<>'single_order_pending' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000041',true);
select public.admin_update_order((select id from public.orders where employee_id='00000000-0000-0000-0000-000000000042'),'cancelled',null,null);
select pg_temp.assert((select access_used_at is null from public.employee_directory where email='a-once@example.test'),'cancellation does not consume one-order access');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000042',true);
select public.create_merch_order('[{"variant_id":"20000000-0000-0000-0000-000000000042","qty":1}]','office',null,null,null,false,null);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000041',true);
select public.admin_update_order((select id from public.orders where employee_id='00000000-0000-0000-0000-000000000042' and status='new'),'ready',null,null);
reset role;
alter table public.employee_audit_log add constraint fail_access_audit check(action<>'access_change') not valid;
set local role authenticated;
do $$ begin
 begin perform public.admin_issue_order((select pickup_code from public.orders where employee_id='00000000-0000-0000-0000-000000000042' and status='ready')); raise exception 'MISSING_DENIAL'; exception when check_violation then null; end;
end $$;
select pg_temp.assert((select access_used_at is null from public.employee_directory where email='a-once@example.test') and (select total_qty=5 and reserved_qty=1 from public.product_variants where sku='A-BOTTLE'),'access audit failure rolls back receipt, access and stock');
reset role;
alter table public.employee_audit_log drop constraint fail_access_audit;
set local role authenticated;
select public.admin_issue_order((select pickup_code from public.orders where employee_id='00000000-0000-0000-0000-000000000042' and status='ready'));
select public.admin_issue_order((select pickup_code from public.orders where employee_id='00000000-0000-0000-0000-000000000042' and status='received'));
select pg_temp.assert((select access_used_at is not null from public.employee_directory where email='a-once@example.test') and (select total_qty=4 and reserved_qty=0 from public.product_variants where sku='A-BOTTLE'),'receipt consumes access once and repeat scan does not deduct again');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000042',true);
select pg_temp.assert(not public.has_system_access() and not exists(select 1 from public.orders),'old authenticated session loses system data after receipt');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000041',true);
update public.employee_directory set access_used_at=null where email='a-once@example.test';
select pg_temp.assert((select is_allowed from public.get_employee_merch_access('a-once@example.test')),'admin can explicitly renew one-order access');
select public.admin_issue_order((select pickup_code from public.orders where employee_id='00000000-0000-0000-0000-000000000042' and status='received'));
select pg_temp.assert((select is_allowed from public.get_employee_merch_access('a-once@example.test')),'old receipt scan does not consume renewed access');
select public.admin_import_employees('[{"email":"batch-period@example.test","full_name":"Batch Period","access_mode":"until_date","access_expires_at":"2099-01-01T00:00:00Z"}]');
select pg_temp.assert((select access_mode='until_date' from public.employee_directory where email='batch-period@example.test'),'bulk import preserves selected access policy');
rollback;
