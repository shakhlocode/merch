begin;

-- Preserve existing orders and custom rule texts. New Welcome orders are office-only.
update public.merch_settings
set welcome_rules=E'Выберите до 3 товаров для своего Welcome pack.\nПо 1 штуке каждого товара.\nВыберите нужный размер и цвет.\nПолучение — только лично в офисе. Выберите офис при оформлении.'
where welcome_rules=E'Выберите до 3 товаров для своего Welcome pack.\nПо 1 штуке каждого товара.\nВыберите нужный размер и цвет.\nПолучение согласуем после оформления заказа.';

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
 if scope='welcome' and (p_is_remote is distinct from false or p_delivery_type is distinct from 'office'::public.delivery_type) then
  raise exception 'welcome_office_only';
 end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'cart_is_empty'; end if;
 perform p.id from public.products p join public.product_variants v on v.product_id=p.id
 where v.id in(select (i->>'variant_id')::uuid from jsonb_array_elements(p_items) i)
 order by p.id for share of p;
 if exists(select 1 from public.product_variants v join public.products p on p.id=v.product_id
  where v.id in(select (i->>'variant_id')::uuid from jsonb_array_elements(p_items) i)
  and p.placement not in (scope,'both')) then raise exception 'product_scope_not_allowed'; end if;
 return public._create_merch_order_stock(p_items,p_delivery_type,p_delivery_address,p_phone,p_comment,p_is_remote,p_country);
end; $$;

create or replace function public.create_merch_order_v2(
 p_items jsonb,p_mode text,p_office_id uuid,p_phone text,p_country text,
 p_city text,p_comment text,p_visit_from date,p_visit_until date
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; scope text;
begin
 -- Serialize a scope change with checkout before checking the allowed mode.
 perform d.id from public.employee_directory d join public.employees e
 on (lower(d.email)=lower(e.email) or d.invitation_user_id=e.id)
 where e.id=auth.uid() for update of d;
 if public.my_store_scope()='welcome' and p_mode is distinct from 'office' then
  raise exception 'welcome_office_only';
 end if;
 result:=public._create_merch_order_v2_base(p_items,p_mode,p_office_id,p_phone,p_country,p_city,p_comment,p_visit_from,p_visit_until);
 select order_scope into scope from public.orders where id=(result->>'id')::uuid;
 return result||jsonb_build_object('order_scope',scope,'pickup_message',public.configured_order_message(scope,p_mode));
end; $$;

-- CREATE OR REPLACE retains prior grants; explicitly document the intended API.
revoke all on function public.create_merch_order(jsonb,public.delivery_type,text,text,text,boolean,text),
 public.create_merch_order_v2(jsonb,text,uuid,text,text,text,text,date,date) from public,anon;
grant execute on function public.create_merch_order(jsonb,public.delivery_type,text,text,text,boolean,text),
 public.create_merch_order_v2(jsonb,text,uuid,text,text,text,text,date,date) to authenticated;
notify pgrst,'reload schema';
commit;
