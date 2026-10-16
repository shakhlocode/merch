begin;
-- A guest may later be promoted. Its old revoked browser must not inherit that role.
-- The guard returns true without a session lookup for all accounts never reset.
create or replace function public.is_super_admin() returns boolean language sql stable security definer set search_path='' as $$
 select public.browser_session_valid() and exists(select 1 from public.employees e join public.shop_super_admins a on a.email=lower(e.email)
 where e.id=auth.uid() and e.is_active);
$$;
create or replace function public.unit_is_admin(p_unit uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.browser_session_valid() and (public.is_super_admin() or exists(select 1 from public.employees e join public.shop_admins a on a.email=lower(e.email)
 where e.id=auth.uid() and e.is_active and a.unit_id=p_unit));
$$;
notify pgrst,'reload schema';
commit;
