\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAILED: %',label; end if; raise notice 'PASS: %',label; end $$;
grant execute on function pg_temp.assert(boolean,text) to authenticated,service_role;
insert into public.employee_directory(id,email,full_name,external_id) values
 ('30000000-0000-0000-0000-000000000051','inv-admin@example.test','Invite admin','INV-ADMIN'),
 ('30000000-0000-0000-0000-000000000052','inv-worker@example.test','Invite worker','INV-WORKER'),
 ('30000000-0000-0000-0000-000000000053','inv-email@example.test','Email worker','INV-MAIL');
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-000000000051','inv-admin@example.test',now()),
 ('00000000-0000-0000-0000-000000000052','inv-worker@example.test',now()),
 ('00000000-0000-0000-0000-000000000053','inv-email@example.test',now()),
 ('00000000-0000-0000-0000-000000000054','i-40000000-0000-0000-0000-000000000052@guest.merch.invalid',now());
update public.employees set is_admin=true where email='inv-admin@example.test';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000051',true);
select public.admin_create_invitation('40000000-0000-0000-0000-000000000051','30000000-0000-0000-0000-000000000052',repeat('a',64),repeat('b',64),'code');
select pg_temp.assert(not has_function_privilege('authenticated','public.claim_invitation(uuid,uuid,text)','EXECUTE') and not has_function_privilege('anon','public.check_invitation_code(text,text)','EXECUTE'),'public clients cannot mint sessions or claim invitations directly');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000052',true);
select pg_temp.assert(not public.has_system_access() and not exists(select 1 from public.employee_invitations),'unclaimed invitation blocks ordinary email login and hides invitation hashes');
reset role; set local role service_role;
select public.check_invitation_code(repeat('a',64),repeat('0',64)) from generate_series(1,8);
select pg_temp.assert((select failed_attempts=8 from public.employee_invitations where id='40000000-0000-0000-0000-000000000051') and not (public.check_invitation_code(repeat('a',64),repeat('b',64))->>'ok')::boolean,'eight failed attempts lock the invitation');
reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000051',true);
select public.admin_create_invitation('40000000-0000-0000-0000-000000000052','30000000-0000-0000-0000-000000000052',repeat('c',64),repeat('d',64),'code');
reset role; set local role service_role;
select pg_temp.assert(not (public.check_invitation_code(repeat('a',64),repeat('b',64))->>'ok')::boolean and (public.check_invitation_code(repeat('c',64),repeat('d',64))->>'ok')::boolean,'regeneration revokes the old link');
do $$ begin
 begin perform public.claim_invitation('40000000-0000-0000-0000-000000000052','00000000-0000-0000-0000-000000000052',repeat('d',64)); raise exception 'MISSING_DENIAL'; exception when others then if sqlerrm<>'invite_unavailable' then raise; end if; end;
end $$;
reset role;
alter table public.employee_audit_log add constraint fail_invitation_claim check(action<>'invite_claimed') not valid;
set local role service_role;
do $$ begin
 begin perform public.claim_invitation('40000000-0000-0000-0000-000000000052','00000000-0000-0000-0000-000000000054',repeat('d',64)); raise exception 'MISSING_DENIAL'; exception when check_violation then null; end;
end $$;
reset role;
select pg_temp.assert((select claimed_at is null from public.employee_invitations where id='40000000-0000-0000-0000-000000000052') and (select not is_active from public.employees where id='00000000-0000-0000-0000-000000000054'),'failed claim transaction leaves no grant or consumed invitation');
reset role; alter table public.employee_audit_log drop constraint fail_invitation_claim;
set local role service_role;
select public.claim_invitation('40000000-0000-0000-0000-000000000052','00000000-0000-0000-0000-000000000054',repeat('d',64));
do $$ begin
 begin perform public.claim_invitation('40000000-0000-0000-0000-000000000052','00000000-0000-0000-0000-000000000054',repeat('d',64)); raise exception 'MISSING_DENIAL'; exception when others then if sqlerrm<>'invite_unavailable' then raise; end if; end;
end $$;
reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000054',true);
select pg_temp.assert(public.has_system_access() and (select is_allowed from public.get_employee_merch_access('i-40000000-0000-0000-0000-000000000052@guest.merch.invalid')),'claimed guest gets access through bound account');
reset role;
insert into public.products(id,name) values('10000000-0000-0000-0000-000000000051','Invite shirt'),('10000000-0000-0000-0000-000000000052','Invite bottle');
insert into public.product_variants(id,product_id,sku) values('20000000-0000-0000-0000-000000000051','10000000-0000-0000-0000-000000000051','INV-SHIRT'),('20000000-0000-0000-0000-000000000052','10000000-0000-0000-0000-000000000052','INV-BOTTLE');
insert into public.stock_movements(variant_id,movement_type,qty) select id,'income',4 from public.product_variants where sku in ('INV-SHIRT','INV-BOTTLE');
set local role authenticated;
select public.create_merch_order('[{"variant_id":"20000000-0000-0000-0000-000000000051","qty":1}]','office',null,null,null,false,null);
do $$ begin
 begin perform public.create_merch_order('[{"variant_id":"20000000-0000-0000-0000-000000000052","qty":1}]','office',null,null,null,false,null); raise exception 'MISSING_DENIAL'; exception when others then if sqlerrm<>'single_order_pending' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000051',true);
select public.admin_update_order((select id from public.orders where employee_id='00000000-0000-0000-0000-000000000054'),'ready',null,null);
select public.admin_issue_order((select pickup_code from public.orders where employee_id='00000000-0000-0000-0000-000000000054'));
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000054',true);
select pg_temp.assert(not public.has_system_access(),'receipt closes invitation access even when original access mode was unlimited');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000052',true);
select pg_temp.assert(not public.has_system_access(),'original email account cannot bypass guest binding');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000051',true);
select public.admin_create_invitation('40000000-0000-0000-0000-000000000053','30000000-0000-0000-0000-000000000053',repeat('e',64),repeat('f',64),'email');
reset role; set local role service_role;
do $$ begin
 begin perform public.claim_invitation('40000000-0000-0000-0000-000000000053','00000000-0000-0000-0000-000000000052',null); raise exception 'MISSING_DENIAL'; exception when others then if sqlerrm<>'invite_wrong_account' then raise; end if; end;
end $$;
select public.claim_invitation('40000000-0000-0000-0000-000000000053','00000000-0000-0000-0000-000000000053',null);
reset role; set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000053',true);
select pg_temp.assert(public.has_system_access(),'email invitation requires the verified recipient account');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000051',true);
select public.admin_import_employees('[{"email":"","full_name":"No-mail employee","external_id":"NO-MAIL-001","invite_mode":"code"}]');
select pg_temp.assert((select invitation_required and invitation_one_order and email like '%@no-mail.merch.invalid' from public.employee_directory where external_id='NO-MAIL-001'),'no-mail import creates an invitation-only prospect, not an active login');
rollback;
