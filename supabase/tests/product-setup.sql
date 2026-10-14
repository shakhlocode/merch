\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAILED: %',label; end if; raise notice 'PASS: %',label; end $$;
grant execute on function pg_temp.assert(boolean,text) to authenticated;
insert into public.employee_directory(email,full_name,hired_at) values ('p-admin@example.test','Product admin',current_date-interval '1 year'),('p-user@example.test','Product employee',current_date-interval '1 year');
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-000000000021','p-admin@example.test'),
 ('00000000-0000-0000-0000-000000000022','p-user@example.test');
update public.employees set is_admin=true where email='p-admin@example.test';
insert into public.products(name) values('Legacy placement');
select pg_temp.assert((select placement='catalog' from public.products where name='Legacy placement'),'existing products default to main catalog');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000022',true);
do $$ begin
  begin perform public.admin_create_product('Denied',null,null,'both','[{"size":"M","color":"","qty":2}]'); raise exception 'MISSING_DENIAL';
  exception when others then if sqlerrm<>'not_admin' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000021',true);
select public.admin_create_product('Range',null,null,'both','[{"size":"S","color":"","qty":3},{"size":"M","color":"","qty":7},{"size":"L","color":"","qty":0}]');
select pg_temp.assert((select count(*)=3 and sum(total_qty)=10 and sum(reserved_qty)=0 from public.product_variants where product_id=(select id from public.products where name='Range')),'size quantities and total saved correctly, zero stock supported');
select pg_temp.assert((select count(*)=2 and sum(qty)=10 from public.stock_movements where variant_id in (select id from public.product_variants where product_id=(select id from public.products where name='Range'))),'initial stock has ledger entries');
select public.admin_create_product('Welcome only','',null,'welcome','[{"size":"ONE SIZE","color":"","qty":5}]');
select pg_temp.assert((select count(*)=0 from public.products where name='Welcome only' and placement in ('catalog','both')) and (select count(*)=2 from public.products where name in ('Range','Welcome only') and placement in ('welcome','both')),'catalog and welcome placement filters');
do $$ begin
  begin perform public.admin_create_product('Duplicate',null,null,'catalog','[{"size":" M ","color":"","qty":1},{"size":"m","color":"","qty":2}]'); raise exception 'MISSING_DENIAL';
  exception when others then if sqlerrm<>'Размер и цвет не должны повторяться' then raise; end if; end;
  begin perform public.admin_create_product('Negative',null,null,'catalog','[{"size":"M","qty":-1}]'); raise exception 'MISSING_DENIAL';
  exception when others then if sqlerrm<>'Количество должно быть целым неотрицательным числом' then raise; end if; end;
  begin perform public.admin_create_product('Fraction',null,null,'catalog','[{"size":"M","qty":1.5}]'); raise exception 'MISSING_DENIAL';
  exception when others then if sqlerrm<>'Количество должно быть целым неотрицательным числом' then raise; end if; end;
  begin perform public.admin_create_product('Empty',null,null,'catalog','[]'); raise exception 'MISSING_DENIAL';
  exception when others then if sqlerrm<>'Укажите от 1 до 100 размеров' then raise; end if; end;
end $$;
reset role;
alter table public.stock_movements add constraint test_product_failure check(comment is distinct from 'Начальный остаток при создании товара') not valid;
set local role authenticated;
do $$ begin
  begin perform public.admin_create_product('Rollback',null,null,'catalog','[{"size":"M","qty":3}]'); raise exception 'MISSING_DENIAL';
  exception when check_violation then null; end;
end $$;
select pg_temp.assert(not exists(select 1 from public.products where name in ('Denied','Duplicate','Negative','Fraction','Empty','Rollback')),'invalid input and stock failure leave no partial products or sizes');
reset role;
update public.employees set is_active=false where email='p-admin@example.test';
set local role authenticated;
do $$ begin
  begin perform public.admin_create_product('Inactive',null,null,'catalog','[{"size":"M","qty":1}]'); raise exception 'MISSING_DENIAL';
  exception when others then if sqlerrm<>'not_admin' then raise; end if; end;
end $$;
rollback;
