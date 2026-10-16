\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAILED: %',label;end if;raise notice 'PASS: %',label;end $$;
grant execute on function pg_temp.assert(boolean,text) to authenticated,service_role;
insert into auth.users(id,email,email_confirmed_at) values
 ('a0000000-0000-4000-8000-000000000001','recover-admin@example.test',now()),
 ('a0000000-0000-4000-8000-000000000002','i-a0000000-0000-4000-8000-000000000002@guest.merch.invalid',now());
insert into public.shop_admins values('recover-admin@example.test','10000000-0000-4000-8000-000000000002');
update public.employees set is_active=true,password_set_at=now() where id in('a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002');
insert into public.employee_directory(id,unit_id,email,full_name,external_id,invitation_user_id,invitation_required,invitation_one_order,access_mode) values
 ('a1000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','pending-recovery@no-mail.merch.invalid','Recovery buyer','RECOVERY-ID','a0000000-0000-4000-8000-000000000002',true,true,'one_order');
insert into auth.sessions values('a2000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002',now()-interval '1 day'),('a2000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000002',now()+interval '1 day');
insert into public.orders(id,unit_id,employee_id,order_number) values('a3000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000002','RECOVERY-EXISTING');
set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
select set_config('request.headers','{"x-merch-unit":"10000000-0000-4000-8000-000000000002"}',true);
select public.admin_recover_browser_access('a1000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001',repeat('1',64),repeat('2',64));
select pg_temp.assert(public.is_admin() and public.has_system_access(),'administrator and unrelated sessions retain access');
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"session_id":"a2000000-0000-4000-8000-000000000001"}',true);
select pg_temp.assert(not public.browser_session_valid() and not public.has_system_access(),'old guest JWT is rejected immediately after recovery');
select pg_temp.assert((select count(*)=0 from public.orders) and (select count(*)=0 from public.employees),'revoked session cannot read private orders or profiles through direct REST');
do $$ begin
 begin perform public.admin_recover_browser_access('a1000000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('3',64),repeat('4',64));raise exception 'EXPECTED_DENIAL_MISSING';exception when others then if sqlerrm<>'not_admin' then raise;end if;end;
end $$;
reset role;
select public.claim_invitation('a4000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002',repeat('2',64));
do $$ begin
 begin perform public.claim_invitation('a4000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002',repeat('2',64));raise exception 'EXPECTED_DENIAL_MISSING';exception when others then if sqlerrm<>'invite_unavailable' then raise;end if;end;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"session_id":"a2000000-0000-4000-8000-000000000002"}',true);
select pg_temp.assert(public.browser_session_valid() and public.has_system_access() and (select count(*)=1 from public.orders where order_number='RECOVERY-EXISTING'),'fresh session keeps the same account and existing order');
reset role;
select pg_temp.assert((select invitation_user_id='a0000000-0000-4000-8000-000000000002' and invitation_one_order and access_mode='one_order' and access_used_at is null from public.employee_directory where external_id='RECOVERY-ID'),'recovery does not reset order limit or employee identity');
select pg_temp.assert((select count(*)=2 from public.employee_audit_log where employee_directory_id='a1000000-0000-4000-8000-000000000001' and action in('browser_access_reset','browser_access_restored')),'both administrator reset and employee recovery are audited');
insert into public.shop_admins values('i-a0000000-0000-4000-8000-000000000002@guest.merch.invalid','10000000-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('request.jwt.claims','{"session_id":"a2000000-0000-4000-8000-000000000001"}',true);
select pg_temp.assert(not public.is_admin(),'revoked guest session cannot inherit an administrator role assigned later');
select set_config('request.jwt.claims','{"session_id":"a2000000-0000-4000-8000-000000000002"}',true);
select pg_temp.assert(public.is_admin(),'fresh recovered session can use a legitimately granted role');
reset role;
delete from public.shop_admins where email='i-a0000000-0000-4000-8000-000000000002@guest.merch.invalid';
update public.employee_directory set access_used_at=now() where external_id='RECOVERY-ID';
set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
do $$ begin
 begin perform public.admin_recover_browser_access('a1000000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('3',64),repeat('4',64));raise exception 'EXPECTED_DENIAL_MISSING';exception when others then if sqlerrm not like 'Разовый доступ%' then raise;end if;end;
end $$;
rollback;
