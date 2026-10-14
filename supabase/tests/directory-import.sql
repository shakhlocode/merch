\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAILED: %',label; end if; raise notice 'PASS: %',label; end $$;
grant execute on function pg_temp.assert(boolean,text) to authenticated;
insert into public.employee_directory(email,full_name) values('i-admin@example.test','Import admin');
insert into auth.users(id,email) values('00000000-0000-0000-0000-000000000031','i-admin@example.test');
update public.employees set is_admin=true where email='i-admin@example.test';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000031',true);
select pg_temp.assert((public.admin_import_employees('[{"email":" New-1@example.test ","full_name":"New One","external_id":"001"},{"email":"new-2@example.test","full_name":"New Two"}]')->>'added')::int=2,'bulk import adds employees without hire date');
select pg_temp.assert((select is_allowed and hired_at is null from public.get_employee_merch_access('new-1@example.test')),'active membership grants immediate access without invented hire date');
update public.employee_directory set is_active=false where email='new-2@example.test';
select pg_temp.assert((public.admin_import_employees('[{"email":"NEW-2@example.test","full_name":"Overwrite"}]')->>'skipped')::int=1 and (select full_name='New Two' and not is_active from public.employee_directory where email='new-2@example.test'),'existing email skipped without overwriting or reactivation');
do $$ begin
 begin perform public.admin_import_employees('[{"email":"rollback@example.test","full_name":"Rollback"},{"email":"duplicate-id@example.test","full_name":"Bad","external_id":"001"}]'); raise exception 'MISSING_DENIAL'; exception when unique_violation then null; end;
 begin perform public.admin_import_employees('[{"email":"good@example.test","full_name":"Good"},{"email":"bad","full_name":"Invalid"}]'); raise exception 'MISSING_DENIAL'; exception when others then if sqlerrm<>'Проверьте email и ФИО во всех строках' then raise; end if; end;
end $$;
select pg_temp.assert(not exists(select 1 from public.employee_directory where email in ('rollback@example.test','duplicate-id@example.test','good@example.test')),'bad file rolls back whole import');
update public.employee_directory set external_id='002' where email='new-1@example.test';
select pg_temp.assert(exists(select 1 from public.employee_audit_log where changed_fields ? 'external_id'),'identifier changes audited');
reset role;
insert into auth.users(id,email) values('00000000-0000-0000-0000-000000000032','new-1@example.test');
insert into public.products(id,name) values('10000000-0000-0000-0000-000000000031','Archive test');
insert into public.product_variants(id,product_id,sku) values('20000000-0000-0000-0000-000000000031','10000000-0000-0000-0000-000000000031','ARCHIVE-TEST');
insert into public.stock_movements(variant_id,movement_type,qty) values('20000000-0000-0000-0000-000000000031','income',3);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000032',true);
select public.create_merch_order('[{"variant_id":"20000000-0000-0000-0000-000000000031","qty":1}]','office',null,null,null,false,null);
do $$ begin
 begin perform public.admin_import_employees('[{"email":"denied@example.test","full_name":"Denied"}]'); raise exception 'MISSING_DENIAL'; exception when others then if sqlerrm<>'not_admin' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000031',true);
update public.products set is_active=false where name='Archive test';
select pg_temp.assert((select total_qty=3 and reserved_qty=1 from public.product_variants where sku='ARCHIVE-TEST'),'archive keeps stock and existing reservation');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000032',true);
select pg_temp.assert(not exists(select 1 from public.products where name='Archive test') and (select count(*)=1 from public.orders where employee_id='00000000-0000-0000-0000-000000000032'),'archived product hidden but order history retained');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000031',true);
update public.products set is_active=true where name='Archive test';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000032',true);
select pg_temp.assert(exists(select 1 from public.products where name='Archive test'),'restoring archive makes product visible');
rollback;
