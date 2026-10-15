begin;
-- Compatibility fix for already installed unit isolation: custom executor roles
-- cannot be granted hosted Supabase's auth schema by the postgres API role.
create or replace function public.request_user_id() returns uuid language sql stable security definer set search_path='' as $$ select auth.uid(); $$;
revoke all on function public.request_user_id() from public,anon;
grant execute on function public.request_user_id() to merch_executor;
do $$ declare f record; definition text; begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proowner='merch_executor'::regrole loop
  definition:=replace(pg_get_functiondef(f.oid),'auth.uid()','public.request_user_id()');
  execute definition;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
