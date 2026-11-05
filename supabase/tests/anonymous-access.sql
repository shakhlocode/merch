\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAILED: %',label;end if;raise notice 'PASS: %',label;end $$;
grant execute on function pg_temp.assert(boolean,text) to authenticated;
insert into public.employee_directory(email,full_name,hired_at) values('anon-self@example.test','Self',current_date-interval '1 year'),('anon-other@example.test','Other',current_date-interval '2 years');
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000095','anon-self@example.test');
select pg_temp.assert(not has_function_privilege('anon','public.get_employee_merch_access(text)','execute'),'anon inherits no employee lookup EXECUTE through PUBLIC');
set local role anon;
do $$ begin
 begin perform public.get_employee_merch_access('anon-other@example.test');raise exception 'MISSING_DENIAL';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
 begin perform public.get_employee_merch_access('anon-other@example.test');raise exception 'MISSING_DENIAL';exception when others then if sqlerrm<>'not_allowed' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000095',true);
select pg_temp.assert((select is_allowed from public.get_employee_merch_access('anon-self@example.test')),'employee may inspect own access');
do $$ begin
 begin perform public.get_employee_merch_access('anon-other@example.test');raise exception 'MISSING_DENIAL';exception when others then if sqlerrm<>'not_allowed' then raise;end if;end;
end $$;
select pg_temp.assert(true,'ordinary authenticated employee cannot probe another email');
reset role;
update public.employees set is_admin=true where email='anon-self@example.test';
set local role authenticated;
do $$ begin
 begin perform public.get_employee_merch_access('anon-other@example.test');raise exception 'MISSING_DENIAL';exception when others then if sqlerrm<>'not_allowed' then raise;end if;end;
end $$;
select pg_temp.assert(true,'legacy admin flag does not grant directory probing');
reset role;
insert into public.shop_admins values('anon-self@example.test','10000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.assert((select is_allowed from public.get_employee_merch_access('anon-other@example.test')),'current unit admin may inspect own unit participant');
select set_config('request.headers','{"x-merch-unit":"10000000-0000-4000-8000-000000000001"}',true);
do $$ begin
 begin perform public.get_employee_merch_access('anon-other@example.test');raise exception 'MISSING_DENIAL';exception when others then if sqlerrm<>'not_allowed' then raise;end if;end;
end $$;
select pg_temp.assert(true,'unit header cannot turn a unit admin into a global directory reader');
rollback;
