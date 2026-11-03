begin;
-- Explicit definitions supersede the legacy flag and silent replace() migration.
create or replace function public.admin_create_product(p_name text, p_description text, p_image_url text, p_placement text, p_variants jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare product_id uuid; variant_id uuid; item jsonb; n integer; idx integer := 0;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'Название товара обязательно'; end if;
  if p_placement is null or p_placement not in ('catalog','welcome','both') then raise exception 'Выберите раздел для товара'; end if;
  if p_variants is null or jsonb_typeof(p_variants)<>'array' then raise exception 'Укажите размеры и количество'; end if;
  if jsonb_array_length(p_variants) not between 1 and 100 then raise exception 'Укажите от 1 до 100 размеров'; end if;
  for item in select value from jsonb_array_elements(p_variants) loop
    if nullif(trim(item->>'size'),'') is null then raise exception 'Укажите размер в каждой строке'; end if;
    if jsonb_typeof(item->'qty') is distinct from 'number' or (item->>'qty')::numeric < 0 or (item->>'qty')::numeric > 2147483647 or trunc((item->>'qty')::numeric) <> (item->>'qty')::numeric then raise exception 'Количество должно быть целым неотрицательным числом'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_variants) x group by lower(trim(x->>'size')),lower(coalesce(nullif(trim(x->>'color'),''),'')) having count(*)>1) then raise exception 'Размер и цвет не должны повторяться'; end if;
  insert into public.products(name,description,image_url,images,placement) values(trim(p_name),nullif(trim(p_description),''),nullif(trim(p_image_url),''),case when nullif(trim(p_image_url),'') is null then '{}'::text[] else array[trim(p_image_url)] end,p_placement) returning id into product_id;
  for item in select value from jsonb_array_elements(p_variants) loop
    idx := idx+1; n := (item->>'qty')::numeric::integer;
    insert into public.product_variants(product_id,size,color,sku) values(product_id,trim(item->>'size'),nullif(trim(item->>'color'),''),'MERCH-'||product_id::text||'-'||idx::text) returning id into variant_id;
    if n>0 then
      insert into public.stock_movements(variant_id,movement_type,qty,comment,created_by) values(variant_id,'income',n,'Начальный остаток при создании товара',public.request_user_id());
    end if;
  end loop;
  return jsonb_build_object('id',product_id);
end; $$;

create or replace function public.admin_import_employees(p_rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; added integer:=0; skipped integer:=0; n integer; mail text; new_id uuid; created_ids jsonb:='[]'::jsonb;
begin
 if not public.is_admin() then raise exception 'not_admin'; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'Передайте список сотрудников'; end if;
 if jsonb_array_length(p_rows) not between 1 and 2000 then raise exception 'За один раз можно загрузить от 1 до 2000 сотрудников'; end if;
 for item in select value from jsonb_array_elements(p_rows) loop
   if item->>'invite_scope'='welcome' and coalesce(item->>'invite_mode','none') not in ('email','code') then raise exception 'Welcome pack доступен только по приглашению'; end if;
   mail:=lower(trim(item->>'email'));
   if coalesce(mail,'')='' and item->>'invite_mode'='code' then
     if nullif(trim(item->>'external_id'),'') is null then raise exception 'Для входа без почты нужен идентификатор'; end if;
     if exists(select 1 from public.employee_directory where external_id=trim(item->>'external_id')) then skipped:=skipped+1; continue; end if;
     mail:='pending-'||gen_random_uuid()::text||'@no-mail.merch.invalid';
   end if;
   if item->>'invite_mode'='code' and nullif(trim(item->>'external_id'),'') is null then raise exception 'Для личной ссылки нужен идентификатор'; end if;
   if mail is null or mail !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or nullif(trim(item->>'full_name'),'') is null then raise exception 'Проверьте email и ФИО во всех строках'; end if;
   insert into public.employee_directory(store_scope,email,full_name,legal_entity,external_id,access_mode,access_expires_at,invitation_required,invitation_one_order) values(coalesce(item->>'invite_scope','catalog'),mail,trim(item->>'full_name'),nullif(trim(item->>'legal_entity'),''),nullif(trim(item->>'external_id'),''),coalesce(item->>'access_mode','unlimited'),(item->>'access_expires_at')::timestamptz,coalesce(item->>'invite_mode','none')<>'none',coalesce(item->>'invite_mode','none')<>'none') on conflict (lower(email)) do nothing returning id into new_id;
   get diagnostics n=row_count; if n=1 then created_ids:=created_ids||jsonb_build_array(new_id); end if; added:=added+n; skipped:=skipped+1-n;
 end loop;
 return jsonb_build_object('added',added,'skipped',skipped,'employee_ids',created_ids);
end; $$;

create or replace function public.admin_create_variant(p_product_id uuid,p_size text,p_color text,p_sku text,p_initial_qty integer,p_is_active boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare variant_id uuid; selected_unit uuid;
begin
 if not public.is_admin() then raise exception 'not_admin'; end if;
 selected_unit:=public.current_unit_id();
 perform 1 from public.products where id=p_product_id and unit_id=selected_unit for share;
 if not found then raise exception 'product_is_not_available'; end if;
 if nullif(trim(p_sku),'') is null then raise exception 'invalid_sku'; end if;
 if p_initial_qty is null or p_initial_qty<0 then raise exception 'invalid_initial_quantity'; end if;
 insert into public.product_variants(unit_id,product_id,size,color,sku,total_qty,reserved_qty,is_active)
 values(selected_unit,p_product_id,nullif(trim(p_size),''),nullif(trim(p_color),''),trim(p_sku),0,0,coalesce(p_is_active,true)) returning id into variant_id;
 if p_initial_qty>0 then
  insert into public.stock_movements(unit_id,variant_id,movement_type,qty,comment,created_by)
  values(selected_unit,variant_id,'income',p_initial_qty,'Первичное поступление при создании варианта',public.request_user_id());
 end if;
 return jsonb_build_object('id',variant_id);
end; $$;
-- Retain unit-isolating RLS under the non-bypass executor role.
alter function public.admin_create_product(text,text,text,text,jsonb) owner to merch_executor;
alter function public.admin_import_employees(jsonb) owner to merch_executor;
alter function public.admin_create_variant(uuid,text,text,text,integer,boolean) owner to merch_executor;
revoke all on function public.admin_create_product(text,text,text,text,jsonb),public.admin_import_employees(jsonb),public.admin_create_variant(uuid,text,text,text,integer,boolean) from public,anon;
grant execute on function public.admin_create_product(text,text,text,text,jsonb),public.admin_import_employees(jsonb),public.admin_create_variant(uuid,text,text,text,integer,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
