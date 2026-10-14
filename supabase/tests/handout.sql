\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAILED: %',label; end if; raise notice 'PASS: %',label; end $$;
grant execute on function pg_temp.assert(boolean,text) to authenticated;
insert into public.employee_directory(email,full_name,hired_at) values
 ('h-admin1@example.test','Handout admin one',current_date-interval '1 year'),
 ('h-admin2@example.test','Handout admin two',current_date-interval '1 year'),
 ('h-user@example.test','Handout employee',current_date-interval '1 year'),
 ('h-remote@example.test','Remote employee',current_date-interval '1 year');
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-000000000011','h-admin1@example.test'),
 ('00000000-0000-0000-0000-000000000012','h-admin2@example.test'),
 ('00000000-0000-0000-0000-000000000013','h-user@example.test'),
 ('00000000-0000-0000-0000-000000000014','h-remote@example.test');
update public.employees set is_admin=true where email in ('h-admin1@example.test','h-admin2@example.test');
insert into public.products(id,name) values
 ('10000000-0000-0000-0000-000000000011','Handout shirt'),
 ('10000000-0000-0000-0000-000000000012','Handout bottle'),
 ('10000000-0000-0000-0000-000000000013','Out of stock');
insert into public.product_variants(id,product_id,sku) values
 ('20000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000011','H-SHIRT'),
 ('20000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000012','H-BOTTLE'),
 ('20000000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000013','H-EMPTY');
insert into public.stock_movements(variant_id,movement_type,qty)
 select id,'income',4 from public.product_variants where sku in ('H-SHIRT','H-BOTTLE');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000013',true);
select public.create_merch_order('[{"variant_id":"20000000-0000-0000-0000-000000000011","qty":1}]','courier',null,null,null,false,null);
select pg_temp.assert((select pickup_code ~ '^[0-9]{20}$' and pickup_code<>order_number and delivery_type='office' from public.orders),'random numeric pickup code, office-only checkout');
do $$ begin
  begin perform public.admin_issue_order((select pickup_code from public.orders)); raise exception 'MISSING_DENIAL';
  exception when others then if sqlerrm<>'not_admin' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',true);
do $$ begin
  begin perform public.admin_issue_order((select pickup_code from public.orders)); raise exception 'MISSING_DENIAL';
  exception when others then if sqlerrm<>'order_not_ready' then raise; end if; end;
  begin perform public.admin_update_order((select id from public.orders),'received',null,null); raise exception 'MISSING_DENIAL';
  exception when others then if sqlerrm<>'use_pickup_scan' then raise; end if; end;
end $$;
select public.admin_update_order((select id from public.orders),'ready',null,null);
do $$ begin
  begin perform public.admin_replace_order_items((select id from public.orders),'[{"variant_id":"20000000-0000-0000-0000-000000000013","qty":1}]',1); raise exception 'MISSING_DENIAL';
  exception when others then if sqlerrm<>'product_is_not_available' then raise; end if; end;
end $$;
select pg_temp.assert((select reserved_qty=1 from public.product_variants where sku='H-SHIRT') and
 (select status='ready' and version=1 from public.orders),'failed edit rolls back released stock and order readiness');
select public.admin_replace_order_items((select id from public.orders),'[{"variant_id":"20000000-0000-0000-0000-000000000012","qty":1}]',1);
select pg_temp.assert((select reserved_qty=0 from public.product_variants where sku='H-SHIRT') and
 (select reserved_qty=1 from public.product_variants where sku='H-BOTTLE') and
 (select status='assembling' and version=2 and pickup_status='pending' from public.orders),'edit swaps reservations and invalidates readiness');
do $$ begin
  begin perform public.admin_save_order((select id from public.orders),'ready',1,null,null,null,null); raise exception 'MISSING_DENIAL';
  exception when others then if sqlerrm<>'order_changed' then raise; end if; end;
end $$;
select public.admin_update_order((select id from public.orders),'ready',null,null);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000012',true);
select public.admin_issue_order((select pickup_code from public.orders));
select pg_temp.assert((select status='received' and pickup_status='handed_owner' and received_by=auth.uid() and received_by_name='Handout admin two' and received_at is not null from public.orders),'any active admin can issue with identity and timestamp');
select pg_temp.assert((select total_qty=3 and reserved_qty=0 from public.product_variants where sku='H-BOTTLE'),'issue writes off once');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',true);
select pg_temp.assert((public.admin_issue_order((select pickup_code from public.orders))->>'already_issued')::boolean,'repeat scan is idempotent');
select pg_temp.assert((select total_qty=3 and reserved_qty=0 from public.product_variants where sku='H-BOTTLE') and
 (select count(*)=1 from public.order_events where action='issued') and
 (select received_by='00000000-0000-0000-0000-000000000012' from public.orders),'repeat preserves stock, first issuer and single audit event');
do $$ begin
  begin perform public.admin_replace_order_items((select id from public.orders),'[{"variant_id":"20000000-0000-0000-0000-000000000011","qty":1}]',4); raise exception 'MISSING_DENIAL';
  exception when others then if sqlerrm<>'order_items_locked' then raise; end if; end;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000014',true);
select public.create_merch_order('[{"variant_id":"20000000-0000-0000-0000-000000000011","qty":1}]','office',null,null,null,true,'Test country');
select pg_temp.assert((select pickup_code is null and remote_contact_name is not null from public.orders where is_remote),'remote order has contact and no pickup barcode');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000013',true);
select public.create_merch_order('[{"variant_id":"20000000-0000-0000-0000-000000000011","qty":1}]','office',null,null,null,false,null);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',true);
select public.admin_update_order((select id from public.orders where status='new' and not is_remote),'ready',null,null);
reset role;
alter table public.order_events add constraint test_audit_failure check(action<>'issued') not valid;
set local role authenticated;
do $$ begin
  begin perform public.admin_issue_order((select pickup_code from public.orders where status='ready')); raise exception 'MISSING_FAILURE';
  exception when check_violation then null; end;
end $$;
select pg_temp.assert((select count(*)=1 from public.orders where status='ready') and
 (select total_qty=4 and reserved_qty=2 from public.product_variants where sku='H-SHIRT'),'audit failure rolls back issue status and inventory');
reset role;
alter table public.order_events drop constraint test_audit_failure;
set local role authenticated;
select public.admin_update_order((select id from public.orders where status='ready'),'cancelled',null,null);
do $$ begin
  begin perform public.admin_issue_order((select pickup_code from public.orders where status='cancelled')); raise exception 'MISSING_DENIAL';
  exception when others then if sqlerrm<>'order_not_ready' then raise; end if; end;
end $$;
select pg_temp.assert((select reserved_qty=1 from public.product_variants where sku='H-SHIRT'),'cancel releases only its reservation');
rollback;
