create table if not exists demo_installation(id uuid primary key, created_at timestamptz default now());
create table if not exists demo_campaigns(
 id uuid primary key, unit text unique not null, name text not null,
 status text not null default 'open' check(status in('open','closed')),
 closed_at timestamptz, purged_at timestamptz
);
alter table demo_employees add column if not exists campaign_id uuid references demo_campaigns;
alter table demo_employees add column if not exists portal_managed boolean not null default false;
-- Trusted authorization attributes live only as long as the server session.
alter table demo_sessions add column if not exists portal_claims jsonb;
create table if not exists demo_portal_rules(
 id uuid primary key, campaign_id uuid not null references demo_campaigns,
 kind text not null check(kind in('person','legal_entity','group')), value text not null,
 effect text not null check(effect in('allow','deny')), scope text not null check(scope in('catalog','welcome')),
 enabled boolean not null default true,
 unique(campaign_id,kind,value,effect,scope)
);
create table if not exists demo_roles(user_id uuid references demo_users on delete cascade, unit text not null, role text not null check(role in('admin','super')), primary key(user_id,unit));
create table if not exists demo_variants(
 id uuid primary key, unit text not null, product text not null, scope text not null,
 size text not null, color text not null, image_name text not null,
 total integer not null check(total>=0), reserved integer not null default 0 check(reserved>=0 and reserved<=total),
 threshold integer not null default 5 check(threshold>=0), active boolean not null default true
);
alter table demo_orders add column if not exists campaign_id uuid references demo_campaigns;
alter table demo_orders add column if not exists status text not null default 'new' check(status in('new','assembling','ready','received','cancelled'));
alter table demo_orders add column if not exists request_key uuid;
alter table demo_orders add column if not exists pickup_hash text unique;
alter table demo_orders add column if not exists pickup_cipher text;
alter table demo_orders add column if not exists received_at timestamptz;
alter table demo_orders add column if not exists received_by uuid references demo_users on delete set null;
create unique index if not exists demo_order_retry_key on demo_orders(user_id,request_key);
create unique index if not exists demo_one_order on demo_orders(user_id,campaign_id) where status<>'cancelled';
create table if not exists demo_order_items(
 order_id uuid references demo_orders on delete cascade,
 variant_id uuid references demo_variants, qty integer not null check(qty=1),
 primary key(order_id,variant_id)
);
create table if not exists demo_stock_movements(
 id uuid primary key, variant_id uuid references demo_variants,
 order_id uuid references demo_orders on delete set null,
 campaign_id uuid references demo_campaigns,
 delta_total integer not null, delta_reserved integer not null,
 kind text not null, actor uuid references demo_users on delete set null,
 created_at timestamptz not null default now()
);
create table if not exists demo_aggregates(
 campaign_id uuid references demo_campaigns, variant_id uuid references demo_variants,
 qty integer not null, primary key(campaign_id,variant_id)
);
alter table demo_invites add column if not exists revoked boolean not null default false;
alter table demo_invites add column if not exists recovery_user_id uuid references demo_users on delete cascade;
create table if not exists demo_outbox(
 id uuid primary key, employee_id uuid references demo_employees on delete cascade,
 content_cipher text not null, expires_at timestamptz not null,
 created_at timestamptz default now()
);
create table if not exists demo_policy(
 singleton boolean primary key default true check(singleton), profile_days integer not null check(profile_days>=1),
 log_days integer not null check(log_days>=1)
);
alter table demo_events add column if not exists actor_id uuid references demo_users on delete set null;
insert into demo_policy values(true,30,30) on conflict do nothing;

create or replace function demo_retention_preview() returns jsonb language sql security definer set search_path=public,pg_catalog as $$
 select jsonb_build_object('installation',(select id from demo_installation limit 1),'policy',(select row_to_json(p) from demo_policy p),
 'due',coalesce((select jsonb_agg(c.id) from demo_campaigns c,demo_policy p where c.status='closed' and c.closed_at<now()-make_interval(days=>p.profile_days) and c.purged_at is null),'[]'::jsonb),
 'profiles',(select count(*) from demo_employees where campaign_id is not null),'orders',(select count(*) from demo_orders),
 'sessions',(select count(*) from demo_sessions),'invitations',(select count(*) from demo_invites),'outbox',(select count(*) from demo_outbox));
$$;

create or replace function demo_run_retention(p_restore uuid[] default '{}') returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare c record; n integer:=0; profiles integer:=0; orders integer:=0; k integer;
begin
 perform pg_advisory_xact_lock(77334455);
 for c in select x.* from demo_campaigns x,demo_policy p where
 (x.status='closed' and x.closed_at<now()-make_interval(days=>p.profile_days) and x.purged_at is null) or x.id=any(p_restore)
 for update of x loop
   -- Closing releases all remaining reservations before deleting personal orders.
   perform v.id from demo_variants v where v.id in(select i.variant_id from demo_order_items i join demo_orders o on o.id=i.order_id where o.campaign_id=c.id) order by v.id for update;
   update demo_variants v set reserved=v.reserved-q.qty from(
     select i.variant_id,sum(i.qty)::integer qty from demo_order_items i join demo_orders o on o.id=i.order_id
     where o.campaign_id=c.id and o.status in('new','assembling','ready') group by i.variant_id)q where v.id=q.variant_id;
   -- Recompute, never add, so restore/replay cannot duplicate aggregate counts.
   insert into demo_aggregates(campaign_id,variant_id,qty)
     select c.id,i.variant_id,sum(i.qty)::integer from demo_order_items i join demo_orders o on o.id=i.order_id
     where o.campaign_id=c.id and o.status='received' group by i.variant_id
     on conflict(campaign_id,variant_id) do update set qty=excluded.qty;
   select count(*) into k from demo_employees where campaign_id=c.id;profiles:=profiles+k;
   delete from demo_stock_movements where campaign_id=c.id;
   delete from demo_orders where campaign_id=c.id;get diagnostics k=row_count;orders:=orders+k;
   delete from demo_outbox where employee_id in(select id from demo_employees where campaign_id=c.id);
   delete from demo_invites where employee_id in(select id from demo_employees where campaign_id=c.id);
   delete from demo_sessions where user_id in(select u.id from demo_users u join demo_employees e on e.id=u.employee_id where e.campaign_id=c.id);
   delete from demo_users where employee_id in(select id from demo_employees where campaign_id=c.id);
   delete from demo_employees where campaign_id=c.id;
   delete from demo_portal_rules where campaign_id=c.id;
   update demo_campaigns set status='closed',closed_at=coalesce(closed_at,now()),purged_at=coalesce(purged_at,now()) where id=c.id;
   n:=n+1;
 end loop;
 delete from demo_sessions where expires_at<=now();
 delete from demo_flows where expires_at<=now();
 delete from demo_logout_tokens where expires_at<=now();
 delete from demo_outbox where expires_at<=now();
 delete from demo_invites where expires_at<=now() or revoked;
 delete from demo_events where created_at<now()-(select make_interval(days=>log_days) from demo_policy);
 return jsonb_build_object('campaigns',n,'profiles',profiles,'orders',orders,'finished_at',now());
end; $$;

revoke all on all tables in schema public from public;
revoke all on function demo_retention_preview(),demo_run_retention(uuid[]) from public;
grant select on all tables in schema public to merch_app;
grant insert,update on demo_employees,demo_users,demo_invites,demo_orders,demo_variants,demo_campaigns to merch_app;
grant insert,update on demo_portal_rules to merch_app;
grant insert,delete,update on demo_sessions,demo_flows,demo_logout_tokens,demo_outbox to merch_app;
grant insert on demo_order_items,demo_stock_movements,demo_events to merch_app;
grant usage,select on all sequences in schema public to merch_app;
grant execute on function demo_retention_preview() to merch_app,merch_retention;
grant execute on function demo_run_retention(uuid[]) to merch_retention;
