\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAILED: %',label; end if; raise notice 'PASS: %',label; end $$;
grant execute on function pg_temp.assert(boolean,text) to authenticated;
insert into public.employee_directory(email,full_name) values
 ('contact-admin-a@example.test','Contact admin A'),('contact-admin-b@example.test','Contact admin B'),
 ('contact-user-a@example.test','Contact buyer A'),('contact-user-b@example.test','Contact buyer B');
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-000000000091','contact-admin-a@example.test'),
 ('00000000-0000-0000-0000-000000000092','contact-admin-b@example.test'),
 ('00000000-0000-0000-0000-000000000093','contact-user-a@example.test'),
 ('00000000-0000-0000-0000-000000000094','contact-user-b@example.test');
update public.employees set is_admin=true,phone='+998901234567' where email like 'contact-admin-%';
insert into public.products(id,name) values ('10000000-0000-0000-0000-000000000091','Contact test product');
insert into public.product_variants(id,product_id,sku) values ('20000000-0000-0000-0000-000000000091','10000000-0000-0000-0000-000000000091','CONTACT-TEST');
insert into public.stock_movements(variant_id,movement_type,qty) values ('20000000-0000-0000-0000-000000000091','income',5);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000093',true);
select public.create_merch_order('[{"variant_id":"20000000-0000-0000-0000-000000000091","qty":1}]','office',null,null,null,false,null);
select pg_temp.assert((select assigned_to='00000000-0000-0000-0000-000000000091' and pickup_code is not null from public.orders),'office checkout assigns an active responsible admin without changing barcode behavior');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000094',true);
select public.create_merch_order('[{"variant_id":"20000000-0000-0000-0000-000000000091","qty":1}]','office',null,null,null,true,'Test country');
select pg_temp.assert((select assigned_to='00000000-0000-0000-0000-000000000091' and pickup_code is null from public.orders),'remote checkout assigns a contact without issuing a barcode');
reset role;
select set_config('test.office_id',(select id::text from public.orders where not is_remote),true);
select set_config('test.remote_id',(select id::text from public.orders where is_remote),true);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000093',true);
select pg_temp.assert(not has_function_privilege('anon','public.order_responsible_contacts(uuid[])','EXECUTE'),'anonymous clients cannot query responsible contacts');
select pg_temp.assert((select count(*)=1 and bool_and(order_id=current_setting('test.office_id')::uuid and email='contact-admin-a@example.test' and phone='+998901234567') from public.order_responsible_contacts(array[current_setting('test.office_id')::uuid,current_setting('test.remote_id')::uuid,'99999999-0000-0000-0000-000000000000'])),'mixed guessed IDs expose only the current user assigned contact, not other orders or admins');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000091',true);
select pg_temp.assert((select count(*)=2 from public.order_responsible_contacts(array[current_setting('test.office_id')::uuid,current_setting('test.remote_id')::uuid])),'active admin can read contacts for both orders');
select public.admin_save_order(current_setting('test.office_id')::uuid,'assembling',0,null,null,null,'00000000-0000-0000-0000-000000000092');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000093',true);
select pg_temp.assert((select email='contact-admin-b@example.test' from public.order_responsible_contacts(array[current_setting('test.office_id')::uuid])),'reassignment immediately changes the customer contact');
reset role;
update public.employees set is_active=false where id='00000000-0000-0000-0000-000000000092';
set local role authenticated;
select pg_temp.assert(not exists(select 1 from public.order_responsible_contacts(array[current_setting('test.office_id')::uuid])),'inactive assignee details are hidden');
reset role;
update public.employees set is_active=true where id='00000000-0000-0000-0000-000000000092';
update public.orders set order_scope='welcome' where id=current_setting('test.office_id')::uuid;
set local role authenticated;
select pg_temp.assert(not exists(select 1 from public.order_responsible_contacts(array[current_setting('test.office_id')::uuid])),'old orders from another shop do not reveal contacts');
reset role;
update public.orders set order_scope='catalog' where id=current_setting('test.office_id')::uuid;
update public.employee_directory set is_active=false where email='contact-user-a@example.test';
set local role authenticated;
select pg_temp.assert(not exists(select 1 from public.order_responsible_contacts(array[current_setting('test.office_id')::uuid])),'revoked system access also closes contact access');
reset role;
update public.employee_directory set is_active=true where email='contact-user-a@example.test';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000091',true);
select public.admin_update_order(current_setting('test.office_id')::uuid,'ready',null,null);
select public.admin_issue_order(pickup_code) from public.orders where id=current_setting('test.office_id')::uuid;
select pg_temp.assert((public.admin_issue_order((select pickup_code from public.orders where id=current_setting('test.office_id')::uuid))->>'already_issued')::boolean and (select total_qty=4 and reserved_qty=1 from public.product_variants where sku='CONTACT-TEST'),'office four-stage flow still issues exactly once');
select public.admin_update_order(current_setting('test.remote_id')::uuid,'assembling',null,null);
select public.admin_update_order(current_setting('test.remote_id')::uuid,'shipped',null,null);
select public.admin_update_order(current_setting('test.remote_id')::uuid,'received',null,null);
select public.admin_update_order(current_setting('test.remote_id')::uuid,'received',null,null);
select pg_temp.assert((select total_qty=3 and reserved_qty=0 from public.product_variants where sku='CONTACT-TEST') and (select count(*)=2 from public.orders where status='received'),'remote four-stage flow also deducts once and retains receipt');
rollback;
