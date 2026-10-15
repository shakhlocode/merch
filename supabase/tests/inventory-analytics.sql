\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAILED: %',label;end if;raise notice 'PASS: %',label;end $$;
grant execute on function pg_temp.assert(boolean,text) to authenticated;
insert into public.employee_directory(email,full_name) values ('report-admin@example.test','Report admin'),('report-user@example.test','Report recipient');
insert into auth.users(id,email) values ('00000000-0000-0000-0000-000000000101','report-admin@example.test'),('00000000-0000-0000-0000-000000000102','report-user@example.test');
update public.employees set is_admin=true where email='report-admin@example.test';
insert into public.products(id,name) values ('10000000-0000-0000-0000-000000000101','Report shirt'),('10000000-0000-0000-0000-000000000102','Archived shirt');
insert into public.product_variants(id,product_id,size,color,sku) values
 ('20000000-0000-0000-0000-000000000101','10000000-0000-0000-0000-000000000101','M','Black','REPORT-M'),
 ('20000000-0000-0000-0000-000000000102','10000000-0000-0000-0000-000000000101','L','Black','REPORT-L'),
 ('20000000-0000-0000-0000-000000000103','10000000-0000-0000-0000-000000000101','S','Black','REPORT-INACTIVE'),
 ('20000000-0000-0000-0000-000000000104','10000000-0000-0000-0000-000000000102','M','Black','REPORT-ARCHIVE');
insert into public.stock_movements(variant_id,movement_type,qty) select id,'income',20 from public.product_variants;
update public.products set is_active=false where name='Archived shirt';
update public.product_variants set is_active=false where sku='REPORT-INACTIVE';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000102',true);
do $$begin
 begin perform public.admin_stock_report('');raise exception 'MISSING_DENIAL';exception when others then if sqlerrm<>'not_admin' then raise;end if;end;
 begin perform public.admin_handout_report('2026-10-15','2026-10-15');raise exception 'MISSING_DENIAL';exception when others then if sqlerrm<>'not_admin' then raise;end if;end;
 update public.product_variants set low_stock_threshold=100 where sku='REPORT-M';
end $$;
select pg_temp.assert((select low_stock_threshold=5 from public.product_variants where sku='REPORT-M'),'recipient cannot edit inventory warning thresholds');
select set_config('test.a',public.create_merch_order('[{"variant_id":"20000000-0000-0000-0000-000000000101","qty":1}]','office',null,null,null,false,null)->>'id',true);
select set_config('test.b',public.create_merch_order('[{"variant_id":"20000000-0000-0000-0000-000000000102","qty":1}]','office',null,null,null,false,null)->>'id',true);
select set_config('test.c',public.create_merch_order('[{"variant_id":"20000000-0000-0000-0000-000000000101","qty":1}]','office',null,null,null,false,null)->>'id',true);
select set_config('test.d',public.create_merch_order('[{"variant_id":"20000000-0000-0000-0000-000000000101","qty":1}]','office',null,null,null,false,null)->>'id',true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',true);
select public.admin_update_order(id,'ready',null,null) from public.orders;
select public.admin_issue_order(pickup_code) from public.orders;
select public.admin_issue_order(pickup_code) from public.orders where id=current_setting('test.a')::uuid;
reset role;
update public.orders set created_at='2026-01-01',received_at=case id
 when current_setting('test.a')::uuid then '2026-10-14 19:00:00+00'::timestamptz
 when current_setting('test.b')::uuid then '2026-10-15 18:59:59.999+00'::timestamptz
 when current_setting('test.c')::uuid then '2026-10-15 19:00:00+00'::timestamptz
 else '2026-10-14 18:59:59.999+00'::timestamptz end;
set local role authenticated;
select pg_temp.assert(not has_function_privilege('anon','public.admin_handout_report(date,date,text,text,text)','EXECUTE') and not has_function_privilege('anon','public.admin_stock_report(text)','EXECUTE'),'anonymous clients cannot access analytics RPCs');
select pg_temp.assert(public.admin_handout_report('2026-10-15','2026-10-15')->>'order_count'='2' and public.admin_handout_report('2026-10-15','2026-10-15')->>'units'='2','report uses receipt date with inclusive Tashkent day boundaries, not creation date');
select pg_temp.assert(jsonb_array_length(public.admin_handout_report('2026-10-15','2026-10-15')->'items')=2 and jsonb_array_length(public.admin_handout_report('2026-10-15','2026-10-15')->'days')=1 and jsonb_array_length(public.admin_handout_report('2026-10-15','2026-10-15')->'details')=2,'report separates sizes and days and repeat scan adds no extra issued row');
select pg_temp.assert(public.admin_handout_report('2026-10-15','2026-10-15','all','all','REPORT-M')->>'units'='1' and public.admin_handout_report('2026-10-15','2026-10-15','welcome')->>'units'='0' and public.admin_handout_report('2026-10-15','2026-10-15','all','remote_shipping')->>'units'='0','SKU, shop and fulfillment filters isolate the matching receipt lines');
select pg_temp.assert(jsonb_array_length(public.admin_stock_report(''))=2,'archived products and disabled variants produce no warnings or active inventory rows');
-- Reserve without receipt: free quantity is five while physical stock is six.
reset role;
insert into public.stock_movements(variant_id,movement_type,qty) values ('20000000-0000-0000-0000-000000000101','adjustment',-11);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000102',true);
select public.create_merch_order('[{"variant_id":"20000000-0000-0000-0000-000000000101","qty":1}]','office',null,null,null,false,null);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',true);
select pg_temp.assert(public.admin_stock_report('REPORT-M')->0->>'available_qty'='5' and (public.admin_stock_report('REPORT-M')->0->>'alert')::boolean,'default warning triggers at five available units after reservations');
update public.product_variants set low_stock_threshold=4 where sku='REPORT-M';
select pg_temp.assert(not (public.admin_stock_report('REPORT-M')->0->>'alert')::boolean and (select reserved_qty=1 and total_qty=6 from public.product_variants where sku='REPORT-M'),'changing threshold clears warning without changing stock or reservations');
do $$begin
 begin update public.product_variants set low_stock_threshold=-1 where sku='REPORT-M';raise exception 'MISSING_DENIAL';exception when check_violation then null;end;
 begin perform public.admin_handout_report('2026-10-16','2026-10-15');raise exception 'MISSING_DENIAL';exception when others then if sqlerrm<>'invalid_report_period' then raise;end if;end;
end $$;
select public.admin_update_order(id,'cancelled',null,null) from public.orders where status='new';
select pg_temp.assert(public.admin_handout_report('2026-10-15','2026-10-15')->>'units'='2','unreceived and cancelled orders are excluded from issued quantities');
-- Large report: aggregation and detailed exports must exceed PostgREST row cap.
reset role;
insert into public.orders(id,employee_id,status,received_at,is_remote,full_name)
 select gen_random_uuid(),'00000000-0000-0000-0000-000000000102','received','2026-10-15 10:00+00',false,'Bulk report fixture' from generate_series(1,1005);
insert into public.order_items(order_id,product_id,variant_id,product_name,size,color,sku,qty)
 select id,'10000000-0000-0000-0000-000000000101','20000000-0000-0000-0000-000000000101','Report shirt','M','Black','REPORT-M',1 from public.orders where full_name='Bulk report fixture';
set local role authenticated;
select pg_temp.assert(public.admin_handout_report('2026-10-15','2026-10-15')->>'order_count'='1007' and public.admin_handout_report('2026-10-15','2026-10-15')->>'units'='1007' and jsonb_array_length(public.admin_handout_report('2026-10-15','2026-10-15')->'details')=1007,'server aggregation and full details are not truncated at 1000 orders');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000102',true);
do $$begin begin perform public.admin_handout_report('2026-10-15','2026-10-15');raise exception 'MISSING_DENIAL';exception when others then if sqlerrm<>'not_admin' then raise;end if;end;end $$;
rollback;
