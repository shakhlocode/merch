begin;
alter table public.employee_invitations add column recovery_user_id uuid references public.employees(id);
create table public.browser_access_revocations(user_id uuid primary key references public.employees(id), revoked_before timestamptz not null);
alter table public.browser_access_revocations enable row level security;
grant all on public.browser_access_revocations to service_role;

-- Only accounts explicitly reset by an administrator get this additional check.
create function public.browser_session_valid() returns boolean language plpgsql stable security definer set search_path='' as $$
declare cutoff timestamptz; sid text;
begin
 select revoked_before into cutoff from public.browser_access_revocations where user_id=auth.uid();
 if cutoff is null then return true; end if;
 sid:=nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id';
 if sid is null or sid !~ '^[0-9a-fA-F-]{36}$' then return false; end if;
 return exists(select 1 from auth.sessions where id=sid::uuid and user_id=auth.uid() and created_at>cutoff);
end; $$;
revoke all on function public.browser_session_valid() from public,anon;
grant execute on function public.browser_session_valid() to authenticated,merch_executor;
create or replace function public.request_user_id() returns uuid language sql stable security definer set search_path='' as $$
 select case when public.browser_session_valid() then auth.uid() else null end;
$$;
-- Existing application gate and private customer tables only; admin rules stay intact.
create or replace function public.has_system_access() returns boolean language sql stable security definer set search_path='' as $$
 select public.browser_session_valid() and (public.is_admin() or public.my_store_scope() is not null);
$$;
do $$ declare t text; begin
 foreach t in array array['employees','orders','order_items','carts','cart_items'] loop
 execute format('create policy browser_session_guard on public.%I as restrictive for all to authenticated using(public.browser_session_valid()) with check(public.browser_session_valid())',t);
 end loop;
end $$;

create function public.admin_recover_browser_access(p_employee_id uuid,p_id uuid,p_token_hash text,p_code_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.employee_directory%rowtype; mail text;
begin
 if not public.is_admin() then raise exception 'not_admin'; end if;
 select * into d from public.employee_directory where id=p_employee_id and unit_id=public.current_unit_id() for update;
 if not found or not d.is_active or d.invitation_user_id is null then raise exception 'Сначала активируйте личное приглашение сотрудника'; end if;
 if d.access_used_at is not null or (d.access_expires_at is not null and d.access_expires_at<=now()) then raise exception 'Разовый доступ уже использован или истёк. Восстановление не продлевает доступ.'; end if;
 if nullif(trim(d.external_id),'') is null then raise exception 'Для восстановления по ссылке нужен идентификатор'; end if;
 select lower(email) into mail from public.employees where id=d.invitation_user_id and is_active;
 if mail is null or mail not like '%@guest.merch.invalid' then raise exception 'Для аккаунта с почтой используйте восстановление пароля'; end if;
 if exists(select 1 from public.shop_admins where email=mail) or exists(select 1 from public.shop_super_admins where email=mail) then raise exception 'Нельзя восстановить администратора этим способом'; end if;
 if p_token_hash !~ '^[a-f0-9]{64}$' or p_code_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_invitation'; end if;
 insert into public.browser_access_revocations values(d.invitation_user_id,clock_timestamp()) on conflict(user_id) do update set revoked_before=excluded.revoked_before;
 update public.employee_invitations set revoked_at=now() where employee_directory_id=d.id and revoked_at is null;
 insert into public.employee_invitations(id,unit_id,employee_directory_id,channel,token_hash,code_hash,expires_at,created_by,store_scope,recovery_user_id)
 values(p_id,d.unit_id,d.id,'code',p_token_hash,p_code_hash,least(now()+interval '24 hours',coalesce(d.access_expires_at,now()+interval '24 hours')),auth.uid(),d.store_scope,d.invitation_user_id);
 insert into public.employee_audit_log(unit_id,employee_directory_id,actor_id,action,changed_fields) values(d.unit_id,d.id,auth.uid(),'browser_access_reset',jsonb_build_object('invitation_id',p_id,'user_id',d.invitation_user_id));
 return jsonb_build_object('id',p_id,'user_id',d.invitation_user_id,'store_scope',d.store_scope);
end; $$;
revoke all on function public.admin_recover_browser_access(uuid,uuid,text,text) from public,anon;
grant execute on function public.admin_recover_browser_access(uuid,uuid,text,text) to authenticated;
alter function public.claim_invitation(uuid,uuid,text) rename to _claim_invitation_before_recovery;
revoke all on function public._claim_invitation_before_recovery(uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.claim_invitation(p_id uuid,p_user_id uuid,p_code_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.employee_invitations%rowtype; d public.employee_directory%rowtype;
begin
 select * into i from public.employee_invitations where id=p_id for update;
 if i.recovery_user_id is null then return public._claim_invitation_before_recovery(p_id,p_user_id,p_code_hash); end if;
 if i.revoked_at is not null or i.expires_at<=now() or i.claimed_at is not null or i.failed_attempts>=8 or p_user_id is distinct from i.recovery_user_id or p_code_hash is distinct from i.code_hash then raise exception 'invite_unavailable'; end if;
 select * into d from public.employee_directory where id=i.employee_directory_id for update;
 if not d.is_active or d.invitation_user_id is distinct from p_user_id or d.unit_id<>i.unit_id or d.store_scope<>i.store_scope or d.access_used_at is not null or (d.access_expires_at is not null and d.access_expires_at<=now()) then raise exception 'invite_unavailable'; end if;
 update public.employee_invitations set claimed_at=now(),claimed_by=p_user_id where id=i.id;
 insert into public.employee_audit_log(unit_id,employee_directory_id,actor_id,action,changed_fields) values(d.unit_id,d.id,p_user_id,'browser_access_restored',jsonb_build_object('invitation_id',i.id));
 return jsonb_build_object('ok',true,'next',(case when d.store_scope='welcome' then '/welcome' else '/catalog' end)||'?unit='||d.unit_id::text);
end; $$;
revoke all on function public.claim_invitation(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_invitation(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
