-- Corporate lifecycle and per-person retention. Applied after domain.sql.
alter table demo_employees add column if not exists legal_entity text;
alter table demo_employees add column if not exists business_unit text;
alter table demo_employees add column if not exists position text;
alter table demo_employees add column if not exists phone text;
alter table demo_employees add column if not exists pinfl_hash text;
alter table demo_employees add column if not exists hr_personnel boolean not null default false;
alter table demo_employees add column if not exists source_key text;
alter table demo_employees add column if not exists source_delete_at timestamptz;
alter table demo_employees add column if not exists fulfilled_at timestamptz;
alter table demo_employees add column if not exists purge_after timestamptz;
create unique index if not exists demo_pinfl_unique on demo_employees(pinfl_hash) where pinfl_hash is not null;
alter table demo_policy add column if not exists fulfilled_months integer not null default 2 check(fulfilled_months=2);
alter table demo_orders drop constraint if exists demo_orders_status_check;
alter table demo_orders add constraint demo_orders_status_check check(status in('new','assembling','ready','shipped','received','cancelled'));
alter table demo_orders add column if not exists fulfillment text not null default 'office' check(fulfillment in('office','shipment'));
alter table demo_orders add column if not exists shipped_at timestamptz;
alter table demo_variants add column if not exists product_kind text not null default 'Мерч';
alter table demo_variants add column if not exists image_data bytea;
alter table demo_variants add column if not exists image_mime text;
-- Backfill existing synthetic receipts; no real production data is connected.
update demo_employees e set fulfilled_at=q.at,purge_after=((q.at at time zone 'Asia/Tashkent')+interval '2 months') at time zone 'Asia/Tashkent',active=false
 from(select u.employee_id,max(coalesce(o.received_at,o.shipped_at)) at from demo_users u join demo_orders o on o.user_id=u.id where o.status in('received','shipped') group by u.employee_id)q
 where e.id=q.employee_id and e.fulfilled_at is null and q.at is not null;
delete from demo_sessions where user_id in(select u.id from demo_users u join demo_employees e on e.id=u.employee_id where e.fulfilled_at is not null);
create table if not exists demo_source_blocks(key_hash text primary key,created_at timestamptz default now());
create table if not exists demo_source_schedules(key_hash text primary key,delete_at timestamptz not null);
create table if not exists demo_source_events(id uuid primary key,body_hash text not null,expires_at timestamptz not null);

create or replace function demo_erase_people(ids uuid[]) returns integer language plpgsql security definer set search_path=public,pg_catalog as $$
declare e record; n integer:=0;
begin
 perform pg_advisory_xact_lock(77334455);
 for e in select * from demo_employees where id=any(ids) order by id for update loop
  perform o.id from demo_orders o join demo_users u on u.id=o.user_id where u.employee_id=e.id order by o.id for update of o;
  perform v.id from demo_variants v where v.id in(select i.variant_id from demo_order_items i join demo_orders o on o.id=i.order_id join demo_users u on u.id=o.user_id where u.employee_id=e.id) order by v.id for update;
  update demo_variants v set reserved=v.reserved-q.qty from(
   select i.variant_id,sum(i.qty)::integer qty from demo_order_items i join demo_orders o on o.id=i.order_id join demo_users u on u.id=o.user_id
   where u.employee_id=e.id and o.status in('new','assembling','ready') group by i.variant_id)q where v.id=q.variant_id;
  insert into demo_aggregates(campaign_id,variant_id,qty)
   select o.campaign_id,i.variant_id,sum(i.qty)::integer from demo_order_items i join demo_orders o on o.id=i.order_id join demo_users u on u.id=o.user_id
   where u.employee_id=e.id and o.status in('received','shipped') group by o.campaign_id,i.variant_id
   on conflict(campaign_id,variant_id) do update set qty=demo_aggregates.qty+excluded.qty;
  delete from demo_stock_movements where order_id in(select o.id from demo_orders o join demo_users u on u.id=o.user_id where u.employee_id=e.id);
  delete from demo_events where actor_id in(select id from demo_users where employee_id=e.id);
  delete from demo_sessions where user_id in(select id from demo_users where employee_id=e.id);
  delete from demo_invites where employee_id=e.id;
  delete from demo_outbox where employee_id=e.id;
  delete from demo_portal_rules where kind='person' and value=e.corporate_subject;
  delete from demo_orders where user_id in(select id from demo_users where employee_id=e.id);
  delete from demo_users where employee_id=e.id;
  delete from demo_source_schedules where key_hash=e.source_key;
  delete from demo_employees where id=e.id;
  n:=n+1;
 end loop;
 return n;
end; $$;

create or replace function demo_retention_preview() returns jsonb language sql security definer set search_path=public,pg_catalog as $$
 select jsonb_build_object('installation',(select id from demo_installation limit 1),'policy',(select row_to_json(p) from demo_policy p),
 'due',coalesce((select jsonb_agg(id) from demo_campaigns where status='closed' and closed_at<=now()-interval '2 months' and purged_at is null),'[]'::jsonb),
 'people',coalesce((select jsonb_agg(id) from demo_employees where source_delete_at<=now() or purge_after<=now()),'[]'::jsonb),
 'blocks',coalesce((select jsonb_agg(key_hash) from demo_source_schedules where delete_at<=now()),'[]'::jsonb),
 'profiles',(select count(*) from demo_employees where campaign_id is not null),'orders',(select count(*) from demo_orders),
 'sessions',(select count(*) from demo_sessions),'invitations',(select count(*) from demo_invites),'outbox',(select count(*) from demo_outbox));
$$;

create or replace function demo_apply_lifecycle(people uuid[],campaigns uuid[],blocks text[]) returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare ids uuid[]; n integer;
begin
 perform pg_advisory_xact_lock(77334455);
 insert into demo_source_blocks select unnest(blocks),now() on conflict do nothing;
 select coalesce(array_agg(id),'{}') into ids from demo_employees where id=any(people) or campaign_id=any(campaigns) or source_key=any(blocks);
 n:=demo_erase_people(ids);
 delete from demo_source_schedules where key_hash=any(blocks);
 delete from demo_portal_rules where campaign_id=any(campaigns);
 update demo_campaigns set status='closed',closed_at=coalesce(closed_at,now()),purged_at=coalesce(purged_at,now()) where id=any(campaigns);
 delete from demo_email_links where expires_at<=now();delete from demo_email_throttles where expires_at<=now();
 delete from demo_sessions where expires_at<=now();delete from demo_flows where expires_at<=now();
 delete from demo_invites where expires_at<=now() or revoked;delete from demo_outbox where expires_at<=now();
 delete from demo_logout_tokens where expires_at<=now();delete from demo_source_events where expires_at<=now();
 delete from demo_events where created_at<now()-(select make_interval(days=>log_days) from demo_policy);
 return jsonb_build_object('profiles',n,'finished_at',now());
end; $$;
-- Retain the old signature for tooling but remove the old 30-day campaign purge.
create or replace function demo_run_retention(p_restore uuid[] default '{}') returns jsonb language sql security definer set search_path=public,pg_catalog as $$
 select demo_apply_lifecycle('{}',p_restore,'{}');
$$;
revoke all on function demo_erase_people(uuid[]),demo_apply_lifecycle(uuid[],uuid[],text[]) from public,merch_app;
grant execute on function demo_apply_lifecycle(uuid[],uuid[],text[]) to merch_retention;
grant select on demo_source_blocks,demo_source_schedules,demo_source_events to merch_app;
grant insert,update,delete on demo_source_schedules,demo_source_events to merch_app;
grant delete on demo_invites to merch_app;
