begin;
-- The existing default assignee for remote orders now also applies to office
-- orders. Existing assignments and order history are not rewritten.
create or replace function public.initialize_order_handout() returns trigger
language plpgsql security definer set search_path='' as $$
declare a public.employees%rowtype;
begin
 new.delivery_type:='office';
 if new.assigned_to is null then
  select * into a from public.employees where is_admin and is_active order by created_at,id limit 1;
  new.assigned_to:=a.id;
 else
  select * into a from public.employees where id=new.assigned_to and is_admin and is_active;
  if not found then raise exception 'contact_not_admin'; end if;
 end if;
 if new.is_remote then
  new.pickup_code:=null;
  new.remote_contact_name:=a.full_name;
 else
  new.pickup_code:=public.generate_pickup_code();
 end if;
 return new;
end; $$;

-- Only expose the assigned administrator for orders visible to this caller.
-- Customers still cannot enumerate the employee directory or other admins.
create function public.order_responsible_contacts(p_order_ids uuid[])
returns table(order_id uuid,full_name text,email text,phone text)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.has_system_access() then return; end if;
 if coalesce(cardinality(p_order_ids),0)>2000 then raise exception 'too_many_orders'; end if;
 return query select o.id,e.full_name,e.email,e.phone
 from public.orders o join public.employees e on e.id=o.assigned_to and e.is_admin and e.is_active
 where o.id=any(p_order_ids)
 and (public.is_admin() or (o.employee_id=auth.uid() and o.order_scope=public.my_store_scope()));
end; $$;
revoke all on function public.order_responsible_contacts(uuid[]) from public,anon;
grant execute on function public.order_responsible_contacts(uuid[]) to authenticated;
notify pgrst,'reload schema';
commit;
