\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAILED: %',label; end if; raise notice 'PASS: %',label; end $$;
grant execute on function pg_temp.assert(boolean,text) to authenticated;
insert into public.employee_directory(email,full_name) values('security-old@example.test','Revoked legacy admin');
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000091','security-old@example.test'),
 ('00000000-0000-4000-8000-000000000092','security-new@example.test');
update public.employees set is_admin=true where email='security-old@example.test';
update public.employees set is_admin=false,is_active=true where email='security-new@example.test';
insert into public.shop_admins values('security-old@example.test','10000000-0000-4000-8000-000000000002'),('security-new@example.test','10000000-0000-4000-8000-000000000002');
-- Revoke the modern role but deliberately keep the legacy flag and directory grant.
delete from public.shop_admins where email='security-old@example.test';
insert into public.products(id,unit_id,name) values
 ('10000000-0000-4000-8000-000000000091','10000000-0000-4000-8000-000000000002','Security own product'),
 ('10000000-0000-4000-8000-000000000092','10000000-0000-4000-8000-000000000001','Security other product');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000091',true);
do $$ begin
 begin perform public.admin_create_product('Denied legacy',null,null,'catalog','[{"size":"M","qty":1}]');raise exception 'MISSING_DENIAL';exception when others then if sqlerrm<>'not_admin' then raise;end if;end;
 begin perform public.admin_import_employees('[{"email":"denied-security@example.test","full_name":"Denied"}]');raise exception 'MISSING_DENIAL';exception when others then if sqlerrm<>'not_admin' then raise;end if;end;
 begin perform public.admin_create_variant('10000000-0000-4000-8000-000000000091','M',null,'SEC-DENIED',1);raise exception 'MISSING_DENIAL';exception when others then if sqlerrm<>'not_admin' then raise;end if;end;
end $$;
select pg_temp.assert(not public.is_admin(),'revoked legacy administrator denied direct privileged RPCs');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000092',true);
select public.admin_create_product('New role product',null,null,'catalog','[{"size":"M","qty":1}]');
select pg_temp.assert((public.admin_import_employees('[{"email":"security-import@example.test","full_name":"Imported"}]')->>'added')::int=1,'new unit admin without legacy flag imports employees');
select public.admin_create_variant('10000000-0000-4000-8000-000000000091','M','Purple','SEC-ATOMIC',4);
select pg_temp.assert((select total_qty=4 and reserved_qty=0 from public.product_variants where sku='SEC-ATOMIC') and (select count(*)=1 from public.stock_movements m join public.product_variants v on v.id=m.variant_id where v.sku='SEC-ATOMIC'),'new role creates variant and initial ledger together');
select public.admin_create_variant('10000000-0000-4000-8000-000000000091','L',null,'SEC-ZERO',0);
select pg_temp.assert((select total_qty=0 from public.product_variants where sku='SEC-ZERO'),'zero initial quantity creates a zero-stock variant');
do $$ begin
 begin perform public.admin_create_variant('10000000-0000-4000-8000-000000000092','M',null,'SEC-CROSS',1);raise exception 'MISSING_DENIAL';exception when others then if sqlerrm<>'product_is_not_available' then raise;end if;end;
 begin perform public.admin_create_variant('10000000-0000-4000-8000-000000000091','M',null,'SEC-NEGATIVE',-1);raise exception 'MISSING_DENIAL';exception when others then if sqlerrm<>'invalid_initial_quantity' then raise;end if;end;
end $$;
select set_config('request.headers','{"x-merch-unit":"10000000-0000-4000-8000-000000000001"}',true);
do $$ begin
 begin perform public.admin_import_employees('[{"email":"cross-security@example.test","full_name":"Denied"}]');raise exception 'MISSING_DENIAL';exception when others then if sqlerrm<>'not_admin' then raise;end if;end;
 begin perform public.admin_create_product('Cross denied',null,null,'catalog','[{"size":"M","qty":1}]');raise exception 'MISSING_DENIAL';exception when others then if sqlerrm<>'not_admin' then raise;end if;end;
end $$;
select set_config('request.headers','{}',true);
reset role;
-- Simulate a failure in the second INSERT, not merely invalid input to the first.
alter table public.stock_movements add constraint security_test_failure check(comment is distinct from 'Первичное поступление при создании варианта') not valid;
set local role authenticated;
do $$ begin
 begin perform public.admin_create_variant('10000000-0000-4000-8000-000000000091','XL',null,'SEC-ROLLBACK',3);raise exception 'MISSING_FAILURE';exception when check_violation then null;end;
end $$;
select pg_temp.assert(not exists(select 1 from public.product_variants where sku='SEC-ROLLBACK'),'failed initial stock INSERT rolls back variant, preventing partial commit');
select pg_temp.assert(not exists(select 1 from public.products where name in('Denied legacy','Cross denied')) and not exists(select 1 from public.product_variants where sku in('SEC-CROSS','SEC-NEGATIVE','SEC-DENIED')),'cross-unit and invalid operations leave no partial records');
reset role;
select pg_temp.assert(not has_function_privilege('anon','public.admin_create_variant(uuid,text,text,text,integer,boolean)','execute'),'anonymous users cannot execute variant RPC');
rollback;
