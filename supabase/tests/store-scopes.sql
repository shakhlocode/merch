\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAILED: %',label; end if; raise notice 'PASS: %',label; end $$;
grant execute on function pg_temp.assert(boolean,text) to authenticated,service_role;
insert into public.employee_directory(id,email,full_name,external_id,store_scope) values
 ('30000000-0000-0000-0000-000000000080','scope-admin@example.test','Scope admin','SCOPE-A','catalog'),
 ('30000000-0000-0000-0000-000000000081','scope-catalog@example.test','Catalog employee','SCOPE-C','catalog'),
 ('30000000-0000-0000-0000-000000000082','scope-welcome@example.test','Welcome employee','SCOPE-W','catalog'),
 ('30000000-0000-0000-0000-000000000084','scope-uninvited@example.test','Uninvited employee','SCOPE-U','welcome');
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-000000000080','scope-admin@example.test',now()),
 ('00000000-0000-0000-0000-000000000081','scope-catalog@example.test',now()),
 ('00000000-0000-0000-0000-000000000082','scope-welcome@example.test',now()),
 ('00000000-0000-0000-0000-000000000084','scope-uninvited@example.test',now());
update public.employees set is_admin=true where email='scope-admin@example.test';
insert into public.shop_admins(email,unit_id) select lower(email),'10000000-0000-4000-8000-000000000002'::uuid from public.employees where is_admin on conflict do nothing;
insert into public.products(id,name,placement) values ('10000000-0000-0000-0000-000000000081','Catalog-only','catalog'),('10000000-0000-0000-0000-000000000082','Welcome-only','welcome'),('10000000-0000-0000-0000-000000000083','Both shops','both');
insert into public.product_variants(id,product_id,sku) values ('20000000-0000-0000-0000-000000000081','10000000-0000-0000-0000-000000000081','SCOPE-C'),('20000000-0000-0000-0000-000000000082','10000000-0000-0000-0000-000000000082','SCOPE-W'),('20000000-0000-0000-0000-000000000083','10000000-0000-0000-0000-000000000083','SCOPE-B');
insert into public.stock_movements(variant_id,movement_type,qty) select id,'income',10 from public.product_variants where sku like 'SCOPE-%';
insert into public.pickup_offices(id,name) values('60000000-0000-0000-0000-000000000080','Scope office');
update public.merch_settings set catalog_rules=E'Catalog rule one\nCatalog rule two',welcome_rules='Welcome rule',pickup_message='Catalog office message',welcome_pickup_message='Welcome office message',welcome_shipping_message='Welcome shipping message',welcome_visit_message='Welcome visit message';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000081',true);
select pg_temp.assert(public.my_store_scope()='catalog' and public.has_shop_access('catalog') and not public.has_shop_access('welcome') and (select count(*)=2 from public.products) and not exists(select 1 from public.product_variants where sku='SCOPE-W'),'catalog recipient cannot read Welcome-only products or variants');
select pg_temp.assert(not has_table_privilege('anon','public.products','SELECT') and not has_table_privilege('anon','public.product_variants','SELECT'),'anonymous public key cannot list either private shop');
select pg_temp.assert(not has_function_privilege('authenticated','public._create_merch_order_stock(jsonb,public.delivery_type,text,text,text,boolean,text)','EXECUTE') and not has_function_privilege('authenticated','public._create_merch_order_v2_base(jsonb,text,uuid,text,text,text,text,date,date)','EXECUTE') and not has_function_privilege('authenticated','public._admin_create_invitation_base(uuid,uuid,text,text,text)','EXECUTE'),'private compatibility helpers cannot bypass scope guards');
do $$ begin
 begin perform public.create_merch_order('[{"variant_id":"20000000-0000-0000-0000-000000000082","qty":1}]','office',null,null,null,false,null);raise exception 'MISSING_DENIAL';exception when others then if sqlerrm<>'product_scope_not_allowed' then raise;end if;end;
end $$;
select public.create_merch_order('[{"variant_id":"20000000-0000-0000-0000-000000000081","qty":1}]','office',null,null,null,false,null);
select pg_temp.assert((select order_scope='catalog' from public.orders),'legacy checkout receives correct scope without changing existing catalog access');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000084',true);
select pg_temp.assert(not public.has_system_access() and public.my_store_scope() is null,'setting Welcome scope without a claimed invitation grants no access');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000080',true);
do $$ begin
 begin perform public.admin_create_invitation('40000000-0000-0000-0000-000000000081','30000000-0000-0000-0000-000000000081',repeat('1',64),repeat('2',64),'email','welcome');raise exception 'MISSING_DENIAL';exception when others then if sqlerrm<>'Сначала завершите или отмените текущий заказ' then raise;end if;end;
end $$;
select public.admin_create_invitation('40000000-0000-0000-0000-000000000082','30000000-0000-0000-0000-000000000082',repeat('3',64),repeat('4',64),'email','welcome');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000082',true);
select pg_temp.assert(not public.has_system_access(),'pending Welcome invitation does not grant access before activation');
reset role;set local role service_role;
select pg_temp.assert(public.claim_invitation('40000000-0000-0000-0000-000000000082','00000000-0000-0000-0000-000000000082',null)->>'next'='/welcome?unit=10000000-0000-4000-8000-000000000002','Welcome invite lands on Welcome rather than catalog');
reset role;set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000082',true);
select pg_temp.assert(public.my_store_scope()='welcome' and not public.has_shop_access('catalog') and public.has_shop_access('welcome') and (select count(*)=2 from public.products) and not exists(select 1 from public.product_variants where sku='SCOPE-C'),'Welcome recipient sees only Welcome and both-placement inventory');
do $$ begin
 begin perform public.create_merch_order_v2('[{"variant_id":"20000000-0000-0000-0000-000000000082","qty":1}]','remote_shipping',null,'+998901234567','Kazakhstan','Almaty',null,null,null);raise exception 'MISSING_DENIAL';exception when others then if sqlerrm<>'welcome_office_only' then raise;end if;end;
 begin perform public.create_merch_order_v2('[{"variant_id":"20000000-0000-0000-0000-000000000082","qty":1}]','remote_visit','60000000-0000-0000-0000-000000000080','+998901234567',null,null,null,current_date,current_date+10);raise exception 'MISSING_DENIAL';exception when others then if sqlerrm<>'welcome_office_only' then raise;end if;end;
 begin perform public.create_merch_order('[{"variant_id":"20000000-0000-0000-0000-000000000082","qty":1}]','office',null,null,null,true,'Kazakhstan');raise exception 'MISSING_DENIAL';exception when others then if sqlerrm<>'welcome_office_only' then raise;end if;end;
 begin perform public.create_merch_order('[{"variant_id":"20000000-0000-0000-0000-000000000082","qty":1}]','courier',null,null,null,false,null);raise exception 'MISSING_DENIAL';exception when others then if sqlerrm<>'welcome_office_only' then raise;end if;end;
 begin perform public.create_merch_order_v2('[{"variant_id":"20000000-0000-0000-0000-000000000082","qty":1}]','office',null,'+998901234567',null,null,null,null,null);raise exception 'MISSING_DENIAL';exception when others then if sqlerrm<>'Выберите действующий офис получения' then raise;end if;end;
end $$;
select pg_temp.assert(not exists(select 1 from public.orders) and (select reserved_qty=0 from public.product_variants where sku='SCOPE-W'),'Welcome requires office pickup; remote, visit, legacy shipping and missing office do not create an order or reserve stock');
do $$ begin
 begin perform public.create_merch_order_v2('[{"variant_id":"20000000-0000-0000-0000-000000000081","qty":1}]','office','60000000-0000-0000-0000-000000000080','+998901234567',null,null,null,null,null);raise exception 'MISSING_DENIAL';exception when others then if sqlerrm<>'product_scope_not_allowed' then raise;end if;end;
end $$;
select pg_temp.assert(public.create_merch_order_v2('[{"variant_id":"20000000-0000-0000-0000-000000000082","qty":1},{"variant_id":"20000000-0000-0000-0000-000000000083","qty":1}]','office','60000000-0000-0000-0000-000000000080','+998901234567',null,null,null,null,null)->>'pickup_message'='Welcome office message','Welcome checkout uses its configured office message');
select pg_temp.assert((select count(*)=1 from public.orders) and (select order_scope='welcome' and pickup_code is not null from public.orders),'Welcome order snapshot stays in the permitted shop and uses normal barcode workflow');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000080',true);
do $$ begin
 begin perform public.admin_replace_order_items((select id from public.orders where order_scope='welcome'),'[{"variant_id":"20000000-0000-0000-0000-000000000081","qty":1}]',0);raise exception 'MISSING_DENIAL';exception when others then if sqlerrm<>'product_scope_not_allowed' then raise;end if;end;
end $$;
select pg_temp.assert((select reserved_qty=1 from public.product_variants where sku='SCOPE-W') and (select reserved_qty=1 from public.product_variants where sku='SCOPE-C'),'wrong-shop edit leaves old Welcome items and all reservations intact');
update public.products set placement='catalog' where id='10000000-0000-0000-0000-000000000082';
select public.admin_replace_order_items((select id from public.orders where order_scope='welcome'),'[{"variant_id":"20000000-0000-0000-0000-000000000082","qty":1},{"variant_id":"20000000-0000-0000-0000-000000000083","qty":1}]',0);
select public.admin_update_order(id,'ready',null,null) from public.orders where order_scope='welcome';
select public.admin_issue_order(pickup_code) from public.orders where order_scope='welcome';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000082',true);
select pg_temp.assert(not public.has_system_access() and public.my_store_scope() is null,'receipt closes single-order Welcome access with the existing atomic handout');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000080',true);
select public.admin_create_invitation('40000000-0000-0000-0000-000000000083','30000000-0000-0000-0000-000000000082',repeat('5',64),repeat('6',64),'email','catalog');
reset role;set local role service_role;
select pg_temp.assert(public.claim_invitation('40000000-0000-0000-0000-000000000083','00000000-0000-0000-0000-000000000082',null)->>'next'='/catalog?unit=10000000-0000-4000-8000-000000000002','later distribution can grant catalog access after Welcome order is complete');
reset role;set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000082',true);
select pg_temp.assert(public.my_store_scope()='catalog' and not public.has_shop_access('welcome') and not exists(select 1 from public.orders where order_scope='welcome'),'new catalog grant cannot reopen the previous Welcome shop/history in the customer session');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000080',true);
do $$ begin
 begin perform public.admin_import_employees('[{"email":"bad-scope@example.test","full_name":"No invite","invite_scope":"welcome"}]');raise exception 'MISSING_DENIAL';exception when others then if sqlerrm<>'Welcome pack доступен только по приглашению' then raise;end if;end;
end $$;
select public.admin_import_employees('[{"email":"","full_name":"New Welcome employee","external_id":"SCOPE-IMPORT","invite_mode":"code","invite_scope":"welcome"}]');
select pg_temp.assert((select store_scope='welcome' and invitation_required from public.employee_directory where external_id='SCOPE-IMPORT'),'Welcome import requires invitation and stores isolated pending access');
rollback;
