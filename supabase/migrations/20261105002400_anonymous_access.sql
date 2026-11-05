begin;
-- Explicit effective definition; don't rely on historical function replacement order.
create or replace function public.get_employee_merch_access(p_email text)
returns table(is_allowed boolean,reason text,hired_at date,months_worked integer)
language plpgsql security definer set search_path='' as $$
declare d public.employee_directory%rowtype;
begin
 if not public.browser_session_valid() then raise exception 'not_allowed'; end if;
 if public.request_user_id() is null or (not public.is_admin() and not exists(select 1 from public.employees e where e.id=public.request_user_id() and lower(e.email)=lower(p_email))) then raise exception 'not_allowed'; end if;
 select dr.* into d from public.employee_directory dr left join public.employees e on e.id=dr.invitation_user_id where dr.unit_id=public.current_unit_id() and (lower(dr.email)=lower(p_email) or lower(e.email)=lower(p_email)) limit 1;
 return query select
  coalesce((d.store_scope='catalog' or exists(select 1 from public.employee_invitations i where i.employee_directory_id=d.id and i.store_scope='welcome' and i.claimed_by=d.invitation_user_id and i.revoked_at is null)) and d.is_active and (d.access_mode<>'until_date' or d.access_expires_at>now()) and ((d.access_mode<>'one_order' and not d.invitation_one_order) or d.access_used_at is null) and (not d.invitation_required or d.invitation_user_id=(select id from public.employees where lower(email)=lower(p_email))),false),
  case when d.id is null then 'employee_not_in_directory' when not d.is_active then 'employee_inactive' when d.invitation_required and d.invitation_user_id is distinct from (select id from public.employees where lower(email)=lower(p_email)) then 'invitation_required'
   when d.access_mode='until_date' and d.access_expires_at<=now() then 'access_expired'
   when (d.access_mode='one_order' or d.invitation_one_order) and d.access_used_at is not null then 'access_order_received' else 'ok' end,
  d.hired_at,case when d.hired_at is null then null else extract(year from age(current_date,d.hired_at))::int*12+extract(month from age(current_date,d.hired_at))::int end;
end; $$;

alter function public.get_employee_merch_access(text) owner to merch_executor;
revoke all on function public.get_employee_merch_access(text) from public,anon;
grant execute on function public.get_employee_merch_access(text) to authenticated;
-- Public non-personal schema marker for release checks, not a proof of every RLS policy.
create or replace function public.merch_security_release() returns text
language sql immutable set search_path='' as $$ select 'anonymous-access-20261105'::text $$;
revoke all on function public.merch_security_release() from public;
grant execute on function public.merch_security_release() to anon,authenticated;
notify pgrst,'reload schema';
commit;
