begin;
-- Hosted Supabase default privileges may grant ALL to API roles for new tables.
-- Keep the explicit application contract: members read, admins insert/update
-- through RLS, and deletion is logical so referenced order history stays intact.
revoke all on public.fulfillment_choices from public,anon,authenticated;
grant select,insert,update on public.fulfillment_choices to authenticated;
commit;
