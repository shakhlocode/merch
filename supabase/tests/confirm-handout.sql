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
insert into public.shop_admins(email,unit_id) select lower(email),'10000000-0000-4000-8000-000000000002'::uuid from public.employees where is_admin on conflict do nothing;
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
select public.create_merch_order('[{"variant_id":"20000000-0000-0000-0000-000000000011","qty":1}]','office',null,null,null,false,null);
do $$ begin
 begin perform public.admin_lookup_pickup((select pickup_code from public.orders));raise exception 'MISSING_DENIAL';
 exception when others then if sqlerrm<>'not_admin' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',true);
select pg_temp.assert((public.admin_lookup_pickup((select pickup_code from public.orders))->>'can_issue')::boolean=false,'unprepared lookup does not issue');
select public.admin_save_order((select id from public.orders),'ready',0,null,null,'1 коробка · 2 стеллаж',null);
select pg_temp.assert((public.admin_lookup_pickup((select pickup_code from public.orders))->>'storage_location')='1 коробка · 2 стеллаж','lookup returns free-text storage location');
select pg_temp.assert((select status='ready' and version=1 from public.orders) and (select total_qty=4 and reserved_qty=1 from public.product_variants where sku='H-SHIRT'),'scan changes neither order nor stock');
select public.admin_save_order((select id from public.orders),'ready',1,null,null,'Другая коробка',null);
do $$ begin
 begin perform public.admin_confirm_pickup((select pickup_code from public.orders),(select id from public.orders),1);raise exception 'MISSING_DENIAL';
 exception when others then if sqlerrm<>'order_changed' then raise;end if;end;
end $$;
select pg_temp.assert((select status='ready' from public.orders),'stale confirmation cannot issue');
select public.admin_confirm_pickup((select pickup_code from public.orders),(select id from public.orders),2);
select pg_temp.assert((select status='received' from public.orders) and (select total_qty=3 and reserved_qty=0 from public.product_variants where sku='H-SHIRT'),'explicit confirmation issues and writes stock once');
select pg_temp.assert((public.admin_lookup_pickup((select pickup_code from public.orders))->>'already_issued')::boolean,'repeated scan displays prior receipt');
select pg_temp.assert((public.admin_confirm_pickup((select pickup_code from public.orders),(select id from public.orders),2)->>'already_issued')::boolean and (select total_qty=3 from public.product_variants where sku='H-SHIRT'),'repeat confirmation does not deduct again');
reset role;
select set_config('test.pickup_code',(select pickup_code from public.orders),true);
insert into public.shop_admins(email,unit_id) values('h-admin1@example.test','10000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.headers','{"x-merch-unit":"10000000-0000-4000-8000-000000000001"}',true);
do $$ begin
 begin perform public.admin_lookup_pickup(current_setting('test.pickup_code'));raise exception 'MISSING_DENIAL';
 exception when others then if sqlerrm<>'pickup_not_found' then raise;end if;end;
end $$;
select pg_temp.assert(true,'lookup cannot expose another unit');
rollback;
