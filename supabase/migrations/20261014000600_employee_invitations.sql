begin;
alter table public.employee_directory add column invitation_required boolean not null default false,
 add column invitation_user_id uuid references public.employees(id),
 add column invitation_one_order boolean not null default false;
create table public.employee_invitations (
 id uuid primary key, employee_directory_id uuid not null references public.employee_directory(id),
 channel text not null check(channel in ('email','code')),
 token_hash text not null unique, code_hash text not null,
 expires_at timestamptz not null, created_at timestamptz not null default now(), created_by uuid references public.employees(id),
 claimed_at timestamptz, claimed_by uuid references public.employees(id), revoked_at timestamptz,
 failed_attempts integer not null default 0,
 delivery_status text not null default 'not_needed' check(delivery_status in ('not_needed','queued','sending','sent','failed')),
 delivery_started_at timestamptz, delivery_error text
);
alter table public.employee_invitations enable row level security;
grant select on public.employee_invitations to authenticated;
grant all on public.employee_invitations to service_role;
create policy invitations_admin_read on public.employee_invitations for select to authenticated using(public.is_admin());
create index invitations_directory_idx on public.employee_invitations(employee_directory_id);
create function public.admin_create_invitation(p_id uuid,p_employee_id uuid,p_token_hash text,p_code_hash text,p_channel text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.employee_directory%rowtype; exp timestamptz;
begin
 if not public.is_admin() then raise exception 'not_admin'; end if;
 if p_channel not in ('email','code') or p_token_hash !~ '^[a-f0-9]{64}$' or p_code_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_invitation'; end if;
 select * into d from public.employee_directory where id=p_employee_id for update;
 if not found or not d.is_active then raise exception 'Сотрудник не найден или доступ отключён'; end if;
 if p_channel='code' and nullif(trim(d.external_id),'') is null then raise exception 'Для личной ссылки нужен идентификатор'; end if;
 if p_channel='email' and d.email like '%@%.merch.invalid' then raise exception 'У сотрудника не указана почта'; end if;
 exp:=least(now()+interval '7 days',coalesce(d.access_expires_at,now()+interval '7 days'));
 if exp<=now() then raise exception 'Сначала продлите срок доступа сотрудника'; end if;
 if exists(select 1 from public.orders o join public.employees e on e.id=o.employee_id where
  (lower(e.email)=lower(d.email) or o.employee_id=d.invitation_user_id or o.employee_id in(select claimed_by from public.employee_invitations where employee_directory_id=d.id and claimed_by is not null)) and o.status not in ('received','cancelled','rejected')) then raise exception 'Сначала завершите или отмените текущий заказ'; end if;
 update public.employee_invitations set revoked_at=now() where employee_directory_id=d.id and revoked_at is null;
 update public.employee_directory set invitation_required=true,invitation_user_id=null,invitation_one_order=true where id=d.id;
 insert into public.employee_invitations(id,employee_directory_id,channel,token_hash,code_hash,expires_at,created_by,delivery_status)
 values(p_id,d.id,p_channel,p_token_hash,p_code_hash,exp,auth.uid(),case when p_channel='email' then 'queued' else 'not_needed' end);
 insert into public.employee_audit_log(employee_directory_id,actor_id,action,changed_fields) values(d.id,auth.uid(),'invite_created',jsonb_build_object('invitation_id',p_id,'channel',p_channel));
 return jsonb_build_object('id',p_id,'expires_at',exp,'email',d.email,'full_name',d.full_name,'external_id',d.external_id);
end; $$;
create function public.check_invitation_code(p_token_hash text,p_code_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.employee_invitations%rowtype;
begin
 select * into i from public.employee_invitations where token_hash=p_token_hash and channel='code' for update;
 if not found or i.revoked_at is not null or i.expires_at<=now() or i.claimed_at is not null or i.failed_attempts>=8 then return jsonb_build_object('ok',false); end if;
 if i.code_hash<>p_code_hash then update public.employee_invitations set failed_attempts=failed_attempts+1 where id=i.id; return jsonb_build_object('ok',false); end if;
 if not exists(select 1 from public.employee_directory where id=i.employee_directory_id and is_active and (access_expires_at is null or access_expires_at>now())) then return jsonb_build_object('ok',false); end if;
 return jsonb_build_object('ok',true,'id',i.id);
end; $$;
create function public.claim_invitation(p_id uuid,p_user_id uuid,p_code_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.employee_invitations%rowtype; d public.employee_directory%rowtype; mail text; confirmed timestamptz;
begin
 select * into i from public.employee_invitations where id=p_id for update;
 if not found or i.revoked_at is not null or i.expires_at<=now() or i.claimed_at is not null or i.failed_attempts>=8 then raise exception 'invite_unavailable'; end if;
 select * into d from public.employee_directory where id=i.employee_directory_id for update;
 if not d.is_active or (d.access_expires_at is not null and d.access_expires_at<=now()) then raise exception 'invite_unavailable'; end if;
 select email,email_confirmed_at into mail,confirmed from auth.users where id=p_user_id;
 if i.channel='email' then
  if confirmed is null or lower(mail)<>lower(d.email) then raise exception 'invite_wrong_account'; end if;
 else
  if p_code_hash is distinct from i.code_hash or mail is distinct from 'i-'||i.id::text||'@guest.merch.invalid' then raise exception 'invite_unavailable'; end if;
 end if;
 update public.employees set is_active=true,full_name=d.full_name,password_set_at=case when i.channel='code' then now() else password_set_at end where id=p_user_id;
 update public.employee_directory set invitation_user_id=p_user_id,access_used_at=null where id=d.id;
 update public.employee_invitations set claimed_at=now(),claimed_by=p_user_id where id=i.id;
 insert into public.employee_audit_log(employee_directory_id,actor_id,action,changed_fields) values(d.id,p_user_id,'invite_claimed',jsonb_build_object('invitation_id',i.id,'user_id',p_user_id));
 return jsonb_build_object('ok',true,'next','/catalog');
end; $$;
revoke all on function public.admin_create_invitation(uuid,uuid,text,text,text) from public,anon;
grant execute on function public.admin_create_invitation(uuid,uuid,text,text,text) to authenticated;
revoke all on function public.check_invitation_code(text,text),public.claim_invitation(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.check_invitation_code(text,text),public.claim_invitation(uuid,uuid,text) to service_role;

create or replace function public.get_employee_merch_access(p_email text)
returns table(is_allowed boolean,reason text,hired_at date,months_worked integer)
language plpgsql security definer set search_path='' as $$
declare d public.employee_directory%rowtype;
begin
 if auth.uid() is null or (not public.is_admin() and not exists(select 1 from public.employees e where e.id=auth.uid() and lower(e.email)=lower(p_email))) then raise exception 'not_allowed'; end if;
 select dr.* into d from public.employee_directory dr left join public.employees e on e.id=dr.invitation_user_id where lower(dr.email)=lower(p_email) or lower(e.email)=lower(p_email) limit 1;
 return query select
  coalesce(d.is_active and (d.access_mode<>'until_date' or d.access_expires_at>now()) and ((d.access_mode<>'one_order' and not d.invitation_one_order) or d.access_used_at is null) and (not d.invitation_required or d.invitation_user_id=(select id from public.employees where lower(email)=lower(p_email))),false),
  case when d.id is null then 'employee_not_in_directory' when not d.is_active then 'employee_inactive' when d.invitation_required and d.invitation_user_id is distinct from (select id from public.employees where lower(email)=lower(p_email)) then 'invitation_required'
   when d.access_mode='until_date' and d.access_expires_at<=now() then 'access_expired'
   when (d.access_mode='one_order' or d.invitation_one_order) and d.access_used_at is not null then 'access_order_received' else 'ok' end,
  d.hired_at,case when d.hired_at is null then null else extract(year from age(current_date,d.hired_at))::int*12+extract(month from age(current_date,d.hired_at))::int end;
end; $$;
create or replace function public.has_system_access() returns boolean language sql stable security definer set search_path='' as $$
 select public.is_admin() or exists(select 1 from public.employees e join public.employee_directory d on (lower(d.email)=lower(e.email) or d.invitation_user_id=e.id)
 where e.id=auth.uid() and e.is_active and d.is_active and (not d.invitation_required or d.invitation_user_id=e.id) and (d.access_mode<>'until_date' or d.access_expires_at>now()) and ((d.access_mode<>'one_order' and not d.invitation_one_order) or d.access_used_at is null));
$$;

create or replace function public.check_order_access() returns trigger language plpgsql security definer set search_path='' as $$
declare d public.employee_directory%rowtype;
begin
 select dr.* into d from public.employee_directory dr join public.employees e on (lower(e.email)=lower(dr.email) or dr.invitation_user_id=e.id) where e.id=new.employee_id for update of dr;
 if not found or not d.is_active then raise exception 'employee_not_allowed'; end if;
 if d.access_mode='until_date' and d.access_expires_at<=now() then raise exception 'access_expired'; end if;
 if d.invitation_required and d.invitation_user_id is distinct from new.employee_id then raise exception 'invitation_required'; end if;
 if d.access_mode='one_order' or d.invitation_one_order then
   if d.access_used_at is not null then raise exception 'access_order_received'; end if;
   if exists(select 1 from public.orders where employee_id=new.employee_id and status not in ('received','cancelled','rejected')) then raise exception 'single_order_pending'; end if;
 end if;
 if new.email like '%@guest.merch.invalid' then new.email:=case when d.email like '%@%.merch.invalid' then null else d.email end; end if;
 return new;
end; $$;

create or replace function public.close_access_after_receipt() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='received' and old.status is distinct from new.status then
  update public.employee_directory d set access_used_at=now() from public.employees e
   where e.id=new.employee_id and (lower(d.email)=lower(e.email) or d.invitation_user_id=e.id) and (d.access_mode='one_order' or d.invitation_one_order) and d.access_used_at is null;
 end if;
 return new;
end; $$;

create function public.prevent_second_receipt() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='received' and old.status is distinct from new.status and exists(select 1 from public.employee_directory d join public.employees e on (lower(e.email)=lower(d.email) or d.invitation_user_id=e.id) where e.id=new.employee_id and (d.access_mode='one_order' or d.invitation_one_order) and d.access_used_at is not null) then raise exception 'single_order_already_received'; end if;
 return new;
end; $$;
create trigger prevent_second_receipt before update of status on public.orders for each row execute function public.prevent_second_receipt();
revoke all on function public.prevent_second_receipt() from public,anon,authenticated;
create or replace function public.admin_import_employees(p_rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; added integer:=0; skipped integer:=0; n integer; mail text; new_id uuid; created_ids jsonb:='[]'::jsonb;
begin
 if not exists(select 1 from public.employees where id=auth.uid() and is_admin and is_active) then raise exception 'not_admin'; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'Передайте список сотрудников'; end if;
 if jsonb_array_length(p_rows) not between 1 and 2000 then raise exception 'За один раз можно загрузить от 1 до 2000 сотрудников'; end if;
 for item in select value from jsonb_array_elements(p_rows) loop
   mail:=lower(trim(item->>'email'));
   if coalesce(mail,'')='' and item->>'invite_mode'='code' then
     if nullif(trim(item->>'external_id'),'') is null then raise exception 'Для входа без почты нужен идентификатор'; end if;
     if exists(select 1 from public.employee_directory where external_id=trim(item->>'external_id')) then skipped:=skipped+1; continue; end if;
     mail:='pending-'||gen_random_uuid()::text||'@no-mail.merch.invalid';
   end if;
   if item->>'invite_mode'='code' and nullif(trim(item->>'external_id'),'') is null then raise exception 'Для личной ссылки нужен идентификатор'; end if;
   if mail is null or mail !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or nullif(trim(item->>'full_name'),'') is null then raise exception 'Проверьте email и ФИО во всех строках'; end if;
   insert into public.employee_directory(email,full_name,external_id,access_mode,access_expires_at,invitation_required,invitation_one_order) values(mail,trim(item->>'full_name'),nullif(trim(item->>'external_id'),''),coalesce(item->>'access_mode','unlimited'),(item->>'access_expires_at')::timestamptz,coalesce(item->>'invite_mode','none')<>'none',coalesce(item->>'invite_mode','none')<>'none') on conflict (lower(email)) do nothing returning id into new_id;
   get diagnostics n=row_count; if n=1 then created_ids:=created_ids||jsonb_build_array(new_id); end if; added:=added+n; skipped:=skipped+1-n;
 end loop;
 return jsonb_build_object('added',added,'skipped',skipped,'employee_ids',created_ids);
end; $$;


create function public.revoke_changed_identifier_invites() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.external_id is distinct from old.external_id then update public.employee_invitations set revoked_at=now() where employee_directory_id=new.id and channel='code' and claimed_at is null and revoked_at is null; end if;
 return new;
end; $$;
create trigger revoke_changed_identifier_invites after update of external_id on public.employee_directory for each row execute function public.revoke_changed_identifier_invites();
revoke all on function public.revoke_changed_identifier_invites() from public,anon,authenticated;
commit;
