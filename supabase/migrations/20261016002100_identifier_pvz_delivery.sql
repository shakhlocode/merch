begin;
alter table public.orders add column pvz_code text;
alter table public.merch_settings add column pvz_message text not null default 'Спасибо, заказ принят! Мы свяжемся с вами и доставим мерч в ваш ПВЗ. Если мерч не пришёл в течение двух недель, свяжитесь с ответственным по заказу — контакты указаны ниже.' check(length(pvz_message) between 1 and 4000);
alter table public.fulfillment_choices drop constraint fulfillment_choices_mode_check;
alter table public.fulfillment_choices add constraint fulfillment_choices_mode_check check(mode in('remote_shipping','remote_visit','pvz','placeholder'));
insert into public.fulfillment_choices(unit_id,name,mode,is_active,sort) select id,'Заберу в своём ПВЗ','pvz',true,3 from public.business_units;
-- Retire the old disabled PVZ placeholder; preserve its history.
update public.fulfillment_choices set deleted_at=now(),is_active=false where mode='placeholder' and deleted_at is null and name='Забрать в ПВЗ';
alter table public.orders drop constraint orders_fulfillment_mode_check;
alter table public.orders add constraint orders_fulfillment_mode_check check(fulfillment_mode in('office','remote_shipping','remote_visit','pvz'));
alter table public.orders drop constraint fulfillment_shape;
alter table public.orders add constraint fulfillment_shape check(fulfillment_mode is null or
 (fulfillment_mode='office' and not is_remote and pickup_office_id is not null and visit_from is null and visit_until is null and comment is null) or
 (fulfillment_mode='remote_shipping' and is_remote and pickup_office_id is null and country is not null and city is not null and visit_from is null and visit_until is null) or
 (fulfillment_mode='remote_visit' and not is_remote and pickup_office_id is not null and visit_from is not null and visit_until is not null and visit_until>=visit_from) or
 (fulfillment_mode='pvz' and is_remote and delivery_type='pvz' and pickup_office_id is null and country is null and city is null and visit_from is null and visit_until is null and nullif(trim(pvz_code),'') is not null and length(pvz_code)<=80));
alter table public.orders add constraint pvz_code_shape check((fulfillment_mode is null and pvz_code is null) or (pvz_code is null and delivery_type<>'pvz') or (fulfillment_mode is not null and fulfillment_mode='pvz' and delivery_type='pvz' and pvz_code is not null and length(trim(pvz_code)) between 1 and 80));

create function public.can_use_pvz() returns boolean language sql stable security definer set search_path='' as $$
 select public.has_system_access() and public.my_store_scope()='catalog' and exists(
 select 1 from public.employee_directory d join public.employee_invitations i on i.employee_directory_id=d.id
 where d.unit_id=public.current_unit_id() and d.invitation_user_id=public.request_user_id() and i.claimed_by=d.invitation_user_id and i.claimed_at is not null and i.channel='code');
$$;
revoke all on function public.can_use_pvz() from public,anon;
grant execute on function public.can_use_pvz() to authenticated,merch_executor;
create function public.check_pvz_eligibility() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.fulfillment_mode='pvz' or new.delivery_type='pvz' then
  if tg_op='INSERT' or new.fulfillment_mode is distinct from old.fulfillment_mode or new.pvz_code is distinct from old.pvz_code or new.employee_id is distinct from old.employee_id or new.delivery_type is distinct from old.delivery_type then
   if new.employee_id is distinct from public.request_user_id() or not public.can_use_pvz() then raise exception 'pvz_identifier_only'; end if;
   if new.fulfillment_mode is distinct from 'pvz' or nullif(trim(new.pvz_code),'') is null or length(new.pvz_code)>80 then raise exception 'invalid_pvz_code'; end if;
  end if;
 end if;
 return new;
end; $$;
revoke all on function public.check_pvz_eligibility() from public,anon,authenticated;
create trigger check_pvz_eligibility before insert or update on public.orders for each row execute function public.check_pvz_eligibility();

create function public.create_merch_order_v4(p_items jsonb,p_mode text,p_office_id uuid,p_phone text,p_country text,p_city text,p_comment text,p_visit_from date,p_visit_until date,p_choice_id uuid,p_pvz_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; choice public.fulfillment_choices%rowtype; ident jsonb; code text:=trim(p_pvz_code);
begin
 if p_mode is distinct from 'pvz' then
  if p_pvz_code is not null then raise exception 'invalid_pvz_code'; end if;
  return public.create_merch_order_v3(p_items,p_mode,p_office_id,p_phone,p_country,p_city,p_comment,p_visit_from,p_visit_until,p_choice_id);
 end if;
 perform d.id from public.employee_directory d where d.invitation_user_id=public.request_user_id() for update;
 if not public.can_use_pvz() then raise exception 'pvz_identifier_only'; end if;
 if code is null or length(code) not between 1 and 80 or code ~ '[[:cntrl:]]' then raise exception 'invalid_pvz_code'; end if;
 if p_office_id is not null or p_country is not null or p_city is not null or p_visit_from is not null or p_visit_until is not null then raise exception 'invalid_pvz_details'; end if;
 if p_phone is null or length(regexp_replace(p_phone,'[^0-9]','','g')) not between 7 and 15 or length(p_phone)>40 or length(coalesce(p_comment,''))>2000 then raise exception 'Укажите корректный телефон и комментарий'; end if;
 select * into choice from public.fulfillment_choices where id=p_choice_id and mode='pvz' and is_active and deleted_at is null for share;
 if not found then raise exception 'fulfillment_not_available'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'cart_is_empty'; end if;
 perform p.id from public.products p join public.product_variants v on v.product_id=p.id where v.id in(select (i->>'variant_id')::uuid from jsonb_array_elements(p_items) i) order by p.id for share of p;
 if exists(select 1 from public.product_variants v join public.products p on p.id=v.product_id where v.id in(select (i->>'variant_id')::uuid from jsonb_array_elements(p_items) i) and p.placement not in ('catalog','both')) then raise exception 'product_scope_not_allowed'; end if;
 ident:=public.my_checkout_identity();
 result:=public._create_merch_order_stock(p_items,'office','ПВЗ '||code,p_phone,nullif(trim(p_comment),''),true,null);
 update public.orders set fulfillment_mode='pvz',delivery_type='pvz',pvz_code=code,fulfillment_choice_id=choice.id,fulfillment_choice_name=choice.name,legal_entity=ident->>'legal_entity',full_name=coalesce(ident->>'full_name',full_name),city=null where id=(result->>'id')::uuid;
 return result||jsonb_build_object('pickup_code',null,'fulfillment_mode','pvz','order_scope','catalog','pvz_code',code,'pickup_message',(select pvz_message from public.merch_settings where id=1));
end; $$;
grant create on schema public to merch_executor;
alter function public.create_merch_order_v4(jsonb,text,uuid,text,text,text,text,date,date,uuid,text) owner to merch_executor;
revoke create on schema public from merch_executor;
revoke all on function public.create_merch_order_v4(jsonb,text,uuid,text,text,text,text,date,date,uuid,text) from public,anon;
grant execute on function public.create_merch_order_v4(jsonb,text,uuid,text,text,text,text,date,date,uuid,text) to authenticated;
create policy identifier_pvz_visibility on public.fulfillment_choices as restrictive for select to authenticated using(mode<>'pvz' or public.is_admin() or public.can_use_pvz());
notify pgrst,'reload schema';
commit;
