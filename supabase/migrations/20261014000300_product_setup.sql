begin;
alter table public.products add column if not exists placement text not null default 'catalog';
alter table public.products add constraint products_placement_check check (placement in ('catalog','welcome','both'));

create or replace function public.admin_create_product(p_name text, p_description text, p_image_url text, p_placement text, p_variants jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare product_id uuid; variant_id uuid; item jsonb; n integer; idx integer := 0;
begin
  if not exists(select 1 from public.employees where id=auth.uid() and is_admin and is_active) then raise exception 'not_admin'; end if;
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
      insert into public.stock_movements(variant_id,movement_type,qty,comment,created_by) values(variant_id,'income',n,'Начальный остаток при создании товара',auth.uid());
    end if;
  end loop;
  return jsonb_build_object('id',product_id);
end; $$;
revoke all on function public.admin_create_product(text,text,text,text,jsonb) from public, anon;
grant execute on function public.admin_create_product(text,text,text,text,jsonb) to authenticated;
commit;
