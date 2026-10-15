begin;
-- Display name only; the stable shop UUID/slug and all existing grants stay put.
update public.business_units set name='E-com' where slug='ecom';
-- Product-scoped transfer dialogs must match by UUID, never by display name.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.super_stock_overview()'::regprocedure);
 definition:=replace(definition,'''id'',v.id,''unit_id'',v.unit_id','''id'',v.id,''product_id'',v.product_id,''unit_id'',v.unit_id');
 if strpos(definition,'''product_id'',v.product_id')=0 then raise exception 'stock_overview_product_id_missing'; end if;
 execute definition;
end $$;
notify pgrst,'reload schema';
commit;
