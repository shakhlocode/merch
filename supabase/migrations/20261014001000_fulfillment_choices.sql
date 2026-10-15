begin;
alter table public.pickup_offices add column deleted_at timestamptz,
 add constraint deleted_office_inactive check(deleted_at is null or not is_active);
drop policy offices_read on public.pickup_offices;
create policy offices_read on public.pickup_offices for select to authenticated
 using(public.has_system_access() and (public.is_admin() or deleted_at is null));

create table public.fulfillment_choices (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 120),
 mode text not null check(mode in ('remote_shipping','remote_visit','placeholder')),
 is_active boolean not null default false,
 sort integer not null default 0,
 deleted_at timestamptz,
 constraint placeholder_inactive check(mode<>'placeholder' or not is_active),
 constraint deleted_choice_inactive check(deleted_at is null or not is_active)
);
create unique index fulfillment_choice_mode_unique on public.fulfillment_choices(mode)
 where mode<>'placeholder' and deleted_at is null;
insert into public.fulfillment_choices(name,mode,is_active,sort) values
 ('Удалённо — отправка','remote_shipping',true,1),
 ('Удалённо — заберу в Ташкенте','remote_visit',true,2),
 ('Забрать в ПВЗ','placeholder',false,3),
 ('Курьером','placeholder',false,4);
alter table public.fulfillment_choices enable row level security;
grant select,insert,update on public.fulfillment_choices to authenticated;
create policy choices_read on public.fulfillment_choices for select to authenticated
 using(public.has_system_access() and (public.is_admin() or deleted_at is null));
create policy choices_admin_insert on public.fulfillment_choices for insert to authenticated with check(public.is_admin());
create policy choices_admin_update on public.fulfillment_choices for update to authenticated using(public.is_admin()) with check(public.is_admin());
alter table public.orders add column fulfillment_choice_id uuid references public.fulfillment_choices(id),
 add column fulfillment_choice_name text;

-- Keep the scope/office-only guards and serialize disabling a choice with checkout.
create or replace function public.create_merch_order_v2(
 p_items jsonb,p_mode text,p_office_id uuid,p_phone text,p_country text,
 p_city text,p_comment text,p_visit_from date,p_visit_until date
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; scope text; choice public.fulfillment_choices%rowtype;
begin
 perform d.id from public.employee_directory d join public.employees e
 on (lower(d.email)=lower(e.email) or d.invitation_user_id=e.id)
 where e.id=auth.uid() for update of d;
 if public.my_store_scope()='welcome' and p_mode is distinct from 'office' then raise exception 'welcome_office_only'; end if;
 if p_mode in ('remote_shipping','remote_visit') then
  select * into choice from public.fulfillment_choices where mode=p_mode and is_active and deleted_at is null for share;
  if not found then raise exception 'fulfillment_not_available'; end if;
 elsif p_mode is distinct from 'office' then raise exception 'fulfillment_not_available'; end if;
 result:=public._create_merch_order_v2_base(p_items,p_mode,p_office_id,p_phone,p_country,p_city,p_comment,p_visit_from,p_visit_until);
 update public.orders set fulfillment_choice_id=choice.id,fulfillment_choice_name=choice.name
 where id=(result->>'id')::uuid returning order_scope into scope;
 return result||jsonb_build_object('order_scope',scope,'pickup_message',public.configured_order_message(scope,p_mode),'fulfillment_choice_name',choice.name);
end; $$;

create or replace function public.create_merch_order(
 p_items jsonb,p_delivery_type public.delivery_type,p_delivery_address text,
 p_phone text,p_comment text,p_is_remote boolean,p_country text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare scope text;
begin
 perform d.id from public.employee_directory d join public.employees e
 on (lower(d.email)=lower(e.email) or d.invitation_user_id=e.id)
 where e.id=auth.uid() for update of d;
 scope:=public.my_store_scope();
 if scope is null then raise exception 'employee_not_allowed'; end if;
 if scope='welcome' and (p_is_remote is distinct from false or p_delivery_type is distinct from 'office'::public.delivery_type) then raise exception 'welcome_office_only'; end if;
 if p_delivery_type in ('pvz','courier','pickup') then raise exception 'fulfillment_not_available'; end if;
 if p_is_remote then
  perform id from public.fulfillment_choices where mode='remote_shipping' and is_active and deleted_at is null for share;
  if not found then raise exception 'fulfillment_not_available'; end if;
 end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'cart_is_empty'; end if;
 perform p.id from public.products p join public.product_variants v on v.product_id=p.id
 where v.id in(select (i->>'variant_id')::uuid from jsonb_array_elements(p_items) i) order by p.id for share of p;
 if exists(select 1 from public.product_variants v join public.products p on p.id=v.product_id
  where v.id in(select (i->>'variant_id')::uuid from jsonb_array_elements(p_items) i)
  and p.placement not in (scope,'both')) then raise exception 'product_scope_not_allowed'; end if;
 return public._create_merch_order_stock(p_items,p_delivery_type,p_delivery_address,p_phone,p_comment,p_is_remote,p_country);
end; $$;
-- New UI also supplies the exact configured choice, so deleting and recreating
-- a similarly named mode cannot silently substitute a choice in a stale form.
create function public.create_merch_order_v3(
 p_items jsonb,p_mode text,p_office_id uuid,p_phone text,p_country text,
 p_city text,p_comment text,p_visit_from date,p_visit_until date,p_choice_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform d.id from public.employee_directory d join public.employees e
 on (lower(d.email)=lower(e.email) or d.invitation_user_id=e.id)
 where e.id=auth.uid() for update of d;
 if public.my_store_scope()='welcome' and p_mode is distinct from 'office' then raise exception 'welcome_office_only'; end if;
 if p_mode='office' then
  if p_choice_id is not null then raise exception 'fulfillment_not_available'; end if;
 else
  perform id from public.fulfillment_choices where id=p_choice_id and mode=p_mode
   and mode<>'placeholder' and is_active and deleted_at is null for share;
  if not found then raise exception 'fulfillment_not_available'; end if;
 end if;
 return public.create_merch_order_v2(p_items,p_mode,p_office_id,p_phone,p_country,p_city,p_comment,p_visit_from,p_visit_until);
end; $$;
revoke all on function public.create_merch_order_v3(jsonb,text,uuid,text,text,text,text,date,date,uuid) from public,anon;
grant execute on function public.create_merch_order_v3(jsonb,text,uuid,text,text,text,text,date,date,uuid) to authenticated;
revoke all on function public.create_merch_order(jsonb,public.delivery_type,text,text,text,boolean,text),
 public.create_merch_order_v2(jsonb,text,uuid,text,text,text,text,date,date) from public,anon;
grant execute on function public.create_merch_order(jsonb,public.delivery_type,text,text,text,boolean,text),
 public.create_merch_order_v2(jsonb,text,uuid,text,text,text,text,date,date) to authenticated;
notify pgrst,'reload schema';
commit;
