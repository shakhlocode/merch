-- Reconstructed fresh-project setup. Do not run against the old database.
BEGIN;

-- Source: supabase/base.sql
-- Reconstructed baseline for a NEW Supabase project; not an upgrade script.
-- Final runnable migration is supabase/migrations/20261013000000_merch.sql.
create type public.order_status as enum ('new','review','confirmed','assembling','shipped','received','cancelled','rejected');
create type public.delivery_type as enum ('office','pvz','pickup','courier');
create type public.movement_type as enum ('income','reserve','unreserve','write_off','return','adjustment');

create table public.employees (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null, email text not null unique,
  phone text, department text, position text, city text, office text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.categories (
  id uuid primary key default gen_random_uuid(), name text not null unique,
  sort integer not null default 0
);
create table public.products (
  id uuid primary key default gen_random_uuid(), name text not null,
  description text, material text, category_id uuid references public.categories(id),
  image_url text, images text[] not null default '{}', is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.product_variants (
  id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products(id),
  size text, color text, sku text unique,
  total_qty integer not null default 0 check (total_qty >= 0),
  reserved_qty integer not null default 0 check (reserved_qty >= 0 and reserved_qty <= total_qty),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.product_limits (
  id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products(id),
  limit_per_emp integer not null default 1 check (limit_per_emp > 0),
  period text not null default 'year', department text, created_at timestamptz not null default now()
);
create table public.carts (
  id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employees(id),
  status text not null default 'active', created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.cart_items (
  id uuid primary key default gen_random_uuid(), cart_id uuid not null references public.carts(id) on delete cascade,
  product_id uuid not null references public.products(id), variant_id uuid not null references public.product_variants(id),
  qty integer not null default 1 check (qty > 0), created_at timestamptz not null default now()
);
create sequence public.merch_order_number_seq;
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('MERCH-' || lpad(nextval('public.merch_order_number_seq')::text, 8, '0')),
  employee_id uuid not null references public.employees(id), status public.order_status not null default 'new',
  delivery_type public.delivery_type not null default 'office', delivery_address text,
  full_name text, phone text, email text, city text, department text,
  comment text, admin_comment text, tracking_number text, assigned_to uuid references public.employees(id),
  created_at timestamptz not null default now(), confirmed_at timestamptz, shipped_at timestamptz,
  received_at timestamptz, cancelled_at timestamptz
);
create table public.order_items (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id), variant_id uuid not null references public.product_variants(id),
  product_name text not null, size text, color text, sku text,
  qty integer not null check (qty > 0), created_at timestamptz not null default now(),
  unique (order_id, product_id)
);
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(), variant_id uuid not null references public.product_variants(id),
  movement_type public.movement_type not null, qty integer not null check (qty <> 0),
  order_id uuid references public.orders(id), comment text, created_by uuid references public.employees(id),
  created_at timestamptz not null default now()
);
create index on public.products(category_id);
create index on public.product_variants(product_id);
create index on public.orders(employee_id);
create index on public.orders(created_at desc);
create index on public.order_items(order_id);
create index on public.stock_movements(variant_id);
create index on public.stock_movements(order_id);


-- Source: auth-setup.sql
-- ============================================================
-- Uzum Merch — Auth Setup
-- Run this AFTER schema.sql
-- ============================================================

-- ─── 1. Auto-create employee record on first login ───────────
--
-- When Supabase Auth creates a new user, this trigger inserts
-- a matching row into public.employees so RLS policies work.
-- full_name is taken from the user metadata if provided.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.employees (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Track whether a user has created a password after the first email login.
alter table public.employees
  add column if not exists password_set_at timestamptz;

create or replace function public.mark_password_set()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.employees
     set password_set_at = now()
   where id = auth.uid();
end;
$$;


-- ─── 2. Seed a first admin ───────────────────────────────────
--
-- After the admin user signs in for the first time (which creates
-- their auth.users row and triggers handle_new_user above),
-- promote them manually:
--
--   update employees
--     set is_admin = true, full_name = 'Иванов Иван', department = 'HR'
--     where email = 'admin@uzum.com';


-- ─── 3. Supabase Dashboard settings ─────────────────────────
--
-- Authentication → Providers → Email:
--   [x] Enable Email provider
--   [x] Enable magic links (OTP)
--   [ ] Disable email confirmations (magic link IS the confirmation)
--
-- Authentication → URL Configuration:
--   Site URL:          https://merch.uzum.com   (or http://localhost:3000)
--   Redirect URLs:     https://merch.uzum.com/auth/callback
--                      http://localhost:3000/auth/callback
--
-- Authentication → Email Templates → Magic Link:
--   Customize subject/body to match corporate brand.
--
-- Authentication → Settings → Restrict signups:
--   If you want ONLY @uzum.com emails, add the domain there.
--   This is managed in the Supabase dashboard, not via SQL.


-- Source: employee-merch-rules-and-waybill.sql
-- Run in Supabase SQL editor before deploying the matching application code.
-- Adds HR employee directory, tenure checks, merch selection rules, and waybill audit fields.

alter table public.employees
  add column if not exists business_unit text,
  add column if not exists hired_at date,
  add column if not exists is_active boolean not null default true;

create table if not exists public.employee_directory (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text not null,
  business_unit text,
  position text,
  hired_at date not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists employee_directory_email_lower_key
  on public.employee_directory (lower(email));

alter table public.orders
  add column if not exists shipping_places_count integer,
  add column if not exists shipping_weight_kg numeric(8, 2),
  add column if not exists shipping_package_type text,
  add column if not exists shipping_printed_at timestamptz,
  add column if not exists shipping_printed_by uuid references public.employees(id);

create table if not exists public.employee_audit_log (
  id uuid primary key default gen_random_uuid(),
  employee_directory_id uuid references public.employee_directory(id),
  actor_id uuid references public.employees(id),
  action text not null,
  changed_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.employees e
     where e.id = auth.uid()
       and e.is_admin = true
       and e.is_active = true
  );
$$;

alter table public.employee_directory enable row level security;
alter table public.employee_audit_log enable row level security;

drop policy if exists "Admins manage employee directory" on public.employee_directory;
create policy "Admins manage employee directory"
  on public.employee_directory
  for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins read employee audit log" on public.employee_audit_log;
create policy "Admins read employee audit log"
  on public.employee_audit_log
  for select
  using (public.is_admin());

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists employee_directory_touch_updated_at on public.employee_directory;
create trigger employee_directory_touch_updated_at
  before update on public.employee_directory
  for each row execute procedure public.touch_updated_at();

create or replace function public.sync_employee_from_directory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.employees
     set full_name = new.full_name,
         department = coalesce(new.business_unit, department),
         business_unit = new.business_unit,
         position = new.position,
         hired_at = new.hired_at,
         is_active = new.is_active
   where lower(email) = lower(new.email);

  return new;
end;
$$;

drop trigger if exists employee_directory_sync_employee on public.employee_directory;
create trigger employee_directory_sync_employee
  after insert or update on public.employee_directory
  for each row execute procedure public.sync_employee_from_directory();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  directory_row public.employee_directory%rowtype;
begin
  select *
    into directory_row
    from public.employee_directory
   where lower(email) = lower(new.email)
   limit 1;

  insert into public.employees (
    id,
    email,
    full_name,
    department,
    business_unit,
    position,
    hired_at,
    is_active
  )
  values (
    new.id,
    new.email,
    coalesce(directory_row.full_name, new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    directory_row.business_unit,
    directory_row.business_unit,
    directory_row.position,
    directory_row.hired_at,
    coalesce(directory_row.is_active, false)
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = excluded.full_name,
        department = coalesce(excluded.department, public.employees.department),
        business_unit = coalesce(excluded.business_unit, public.employees.business_unit),
        position = coalesce(excluded.position, public.employees.position),
        hired_at = coalesce(excluded.hired_at, public.employees.hired_at),
        is_active = excluded.is_active;

  return new;
end;
$$;

create or replace function public.get_employee_merch_access(p_email text)
returns table (
  is_allowed boolean,
  reason text,
  hired_at date,
  months_worked integer
)
language sql
security definer
set search_path = ''
as $$
  with directory_row as (
    select *
      from public.employee_directory
     where lower(email) = lower(p_email)
     limit 1
  )
  select
    case
      when not exists (select 1 from directory_row) then false
      when coalesce((select is_active from directory_row), false) = false then false
      when (select hired_at from directory_row) > current_date - interval '3 months' then false
      else true
    end as is_allowed,
    case
      when not exists (select 1 from directory_row) then 'employee_not_in_directory'
      when coalesce((select is_active from directory_row), false) = false then 'employee_inactive'
      when (select hired_at from directory_row) > current_date - interval '3 months' then 'employee_tenure_too_short'
      else 'ok'
    end as reason,
    (select hired_at from directory_row) as hired_at,
    case
      when (select hired_at from directory_row) is null then null
      else (
        extract(year from age(current_date, (select hired_at from directory_row)))::int * 12
        + extract(month from age(current_date, (select hired_at from directory_row)))::int
      )
    end as months_worked;
$$;

-- Prod may already have create_merch_order with default parameter values;
-- create-or-replace cannot remove parameter defaults, so drop the old signature first.
drop function if exists public.create_merch_order(jsonb, public.delivery_type, text, text, text);

create or replace function public.create_merch_order(
  p_items jsonb,
  p_delivery_type public.delivery_type,
  p_delivery_address text,
  p_phone text,
  p_comment text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_access record;
  v_order public.orders%rowtype;
  v_unique_products integer;
  v_total_items integer;
  v_item record;
begin
  select * into v_employee
    from public.employees
   where id = auth.uid();

  if v_employee.id is null then
    raise exception 'employee_not_found';
  end if;

  select * into v_access
    from public.get_employee_merch_access(v_employee.email)
   limit 1;

  if coalesce(v_access.is_allowed, false) = false then
    raise exception '%', coalesce(v_access.reason, 'employee_not_allowed');
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'cart_is_empty';
  end if;

  with normalized as (
    select
      (item->>'variant_id')::uuid as variant_id,
      coalesce((item->>'qty')::int, 0) as qty
    from jsonb_array_elements(p_items) item
  ),
  enriched as (
    select n.variant_id, n.qty, pv.product_id
      from normalized n
      join public.product_variants pv on pv.id = n.variant_id
  )
  select count(*), count(distinct product_id)
    into v_total_items, v_unique_products
    from enriched;

  if v_total_items <> jsonb_array_length(p_items) then
    raise exception 'product_is_not_available';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_items) item
     where coalesce((item->>'qty')::int, 0) <> 1
  ) then
    raise exception 'one_unit_per_product_only';
  end if;

  if v_unique_products > 3 then
    raise exception 'max_unique_products_exceeded';
  end if;

  if v_unique_products <> v_total_items then
    raise exception 'one_variant_per_product_only';
  end if;

  for v_item in
    select
      pv.id as variant_id,
      pv.product_id,
      pv.size,
      pv.color,
      pv.sku,
      pv.total_qty,
      pv.reserved_qty,
      p.name as product_name
    from jsonb_array_elements(p_items) item
    join public.product_variants pv on pv.id = (item->>'variant_id')::uuid
    join public.products p on p.id = pv.product_id
    where pv.is_active = true and p.is_active = true
  loop
    if v_item.total_qty - v_item.reserved_qty < 1 then
      raise exception 'product_is_not_available';
    end if;
  end loop;

  insert into public.orders (
    employee_id,
    delivery_type,
    delivery_address,
    full_name,
    phone,
    email,
    city,
    department,
    comment
  )
  values (
    v_employee.id,
    p_delivery_type,
    p_delivery_address,
    v_employee.full_name,
    coalesce(p_phone, v_employee.phone),
    v_employee.email,
    v_employee.city,
    coalesce(v_employee.business_unit, v_employee.department),
    p_comment
  )
  returning * into v_order;

  for v_item in
    select
      pv.id as variant_id,
      pv.product_id,
      pv.size,
      pv.color,
      pv.sku,
      p.name as product_name
    from jsonb_array_elements(p_items) item
    join public.product_variants pv on pv.id = (item->>'variant_id')::uuid
    join public.products p on p.id = pv.product_id
  loop
    insert into public.order_items (
      order_id,
      product_id,
      variant_id,
      product_name,
      size,
      color,
      sku,
      qty
    )
    values (
      v_order.id,
      v_item.product_id,
      v_item.variant_id,
      v_item.product_name,
      v_item.size,
      v_item.color,
      v_item.sku,
      1
    );

    insert into public.stock_movements (
      variant_id,
      movement_type,
      qty,
      order_id,
      comment,
      created_by
    )
    values (
      v_item.variant_id,
      'reserve',
      -1,
      v_order.id,
      'Reserve for merch order',
      v_employee.id
    );
  end loop;

  return jsonb_build_object(
    'id', v_order.id,
    'order_number', v_order.order_number
  );
end;
$$;


-- Source: merch-handout-features.sql
-- Run in Supabase SQL editor. Adds merch handout/fulfilment features:
-- order storage location, handout status, pickup recipient, and a singleton
-- settings row for the handout deadline / place shown on the dashboard.

-- 1. New order fields ---------------------------------------------------------
alter table public.orders
  add column if not exists storage_location text,
  add column if not exists pickup_status text not null default 'pending',
  add column if not exists handed_to text,
  add column if not exists is_remote boolean not null default false,
  add column if not exists country text;

-- 2. Merch settings (singleton: deadline + place for the next handout) --------
create table if not exists public.merch_settings (
  id integer primary key default 1,
  handout_deadline timestamptz,
  handout_place text,
  handout_note text,
  updated_at timestamptz not null default now(),
  constraint merch_settings_singleton check (id = 1)
);

insert into public.merch_settings (id) values (1) on conflict (id) do nothing;

alter table public.merch_settings enable row level security;

drop policy if exists "merch_settings read" on public.merch_settings;
create policy "merch_settings read"
  on public.merch_settings
  for select
  using (true);

drop policy if exists "merch_settings admin write" on public.merch_settings;
create policy "merch_settings admin write"
  on public.merch_settings
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- 3. Admin RPC to set handout fields on an order ------------------------------
--    Separate from admin_update_order so the existing status flow is untouched.
create or replace function public.admin_set_order_handout(
  p_order_id uuid,
  p_storage_location text,
  p_pickup_status text,
  p_handed_to text
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;

  if p_pickup_status is not null
     and p_pickup_status not in ('pending', 'packed', 'handed_owner', 'handed_other', 'refused') then
    raise exception 'invalid_pickup_status';
  end if;

  update public.orders
     set storage_location = p_storage_location,
         pickup_status    = coalesce(p_pickup_status, pickup_status),
         handed_to        = p_handed_to
   where id = p_order_id
  returning * into v_order;

  if v_order.id is null then
    raise exception 'order_not_found';
  end if;

  return v_order;
end;
$$;


-- Source: employee-directory-audit.sql
-- Run in Supabase SQL editor to enable the in-app employee directory editor.
-- Adds automatic audit logging: every insert/update on employee_directory
-- records who changed what into employee_audit_log. SECURITY DEFINER so the
-- write bypasses the audit-log RLS (which only allows admins to read).

create or replace function public.log_employee_directory_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb := '{}'::jsonb;
begin
  if (tg_op = 'INSERT') then
    insert into public.employee_audit_log (employee_directory_id, actor_id, action, changed_fields)
    values (
      new.id,
      auth.uid(),
      'create',
      to_jsonb(new) - 'id' - 'created_at' - 'updated_at'
    );
    return new;
  end if;

  -- UPDATE: record only the fields that actually changed as [old, new] pairs.
  if new.full_name is distinct from old.full_name then
    v_changes := v_changes || jsonb_build_object('full_name', jsonb_build_array(old.full_name, new.full_name));
  end if;
  if new.email is distinct from old.email then
    v_changes := v_changes || jsonb_build_object('email', jsonb_build_array(old.email, new.email));
  end if;
  if new.business_unit is distinct from old.business_unit then
    v_changes := v_changes || jsonb_build_object('business_unit', jsonb_build_array(old.business_unit, new.business_unit));
  end if;
  if new.position is distinct from old.position then
    v_changes := v_changes || jsonb_build_object('position', jsonb_build_array(old.position, new.position));
  end if;
  if new.hired_at is distinct from old.hired_at then
    v_changes := v_changes || jsonb_build_object('hired_at', jsonb_build_array(old.hired_at, new.hired_at));
  end if;
  if new.is_active is distinct from old.is_active then
    v_changes := v_changes || jsonb_build_object('is_active', jsonb_build_array(old.is_active, new.is_active));
  end if;

  if v_changes <> '{}'::jsonb then
    insert into public.employee_audit_log (employee_directory_id, actor_id, action, changed_fields)
    values (new.id, auth.uid(), 'update', v_changes);
  end if;

  return new;
end;
$$;

drop trigger if exists employee_directory_audit on public.employee_directory;
create trigger employee_directory_audit
  after insert or update on public.employee_directory
  for each row execute procedure public.log_employee_directory_change();


-- Source: merch-remote-order.sql
-- Run in Supabase SQL editor AFTER merch-handout-features.sql.
-- Extends create_merch_order with the "remote worker" flag and country so the
-- checkout can capture them. Drop first: the live signature differs and
-- create-or-replace cannot change a function's argument list.

drop function if exists public.create_merch_order(jsonb, public.delivery_type, text, text, text);
drop function if exists public.create_merch_order(jsonb, public.delivery_type, text, text, text, boolean, text);

create or replace function public.create_merch_order(
  p_items jsonb,
  p_delivery_type public.delivery_type,
  p_delivery_address text,
  p_phone text,
  p_comment text,
  p_is_remote boolean,
  p_country text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_access record;
  v_order public.orders%rowtype;
  v_unique_products integer;
  v_total_items integer;
  v_item record;
begin
  select * into v_employee
    from public.employees
   where id = auth.uid();

  if v_employee.id is null then
    raise exception 'employee_not_found';
  end if;

  select * into v_access
    from public.get_employee_merch_access(v_employee.email)
   limit 1;

  if coalesce(v_access.is_allowed, false) = false then
    raise exception '%', coalesce(v_access.reason, 'employee_not_allowed');
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'cart_is_empty';
  end if;

  with normalized as (
    select
      (item->>'variant_id')::uuid as variant_id,
      coalesce((item->>'qty')::int, 0) as qty
    from jsonb_array_elements(p_items) item
  ),
  enriched as (
    select n.variant_id, n.qty, pv.product_id
      from normalized n
      join public.product_variants pv on pv.id = n.variant_id
  )
  select count(*), count(distinct product_id)
    into v_total_items, v_unique_products
    from enriched;

  if v_total_items <> jsonb_array_length(p_items) then
    raise exception 'product_is_not_available';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_items) item
     where coalesce((item->>'qty')::int, 0) <> 1
  ) then
    raise exception 'one_unit_per_product_only';
  end if;

  if v_unique_products > 3 then
    raise exception 'max_unique_products_exceeded';
  end if;

  if v_unique_products <> v_total_items then
    raise exception 'one_variant_per_product_only';
  end if;

  for v_item in
    select
      pv.id as variant_id,
      pv.product_id,
      pv.size,
      pv.color,
      pv.sku,
      pv.total_qty,
      pv.reserved_qty,
      p.name as product_name
    from jsonb_array_elements(p_items) item
    join public.product_variants pv on pv.id = (item->>'variant_id')::uuid
    join public.products p on p.id = pv.product_id
    where pv.is_active = true and p.is_active = true
  loop
    if v_item.total_qty - v_item.reserved_qty < 1 then
      raise exception 'product_is_not_available';
    end if;
  end loop;

  insert into public.orders (
    employee_id,
    delivery_type,
    delivery_address,
    full_name,
    phone,
    email,
    city,
    department,
    comment,
    is_remote,
    country
  )
  values (
    v_employee.id,
    p_delivery_type,
    p_delivery_address,
    v_employee.full_name,
    coalesce(p_phone, v_employee.phone),
    v_employee.email,
    v_employee.city,
    coalesce(v_employee.business_unit, v_employee.department),
    p_comment,
    coalesce(p_is_remote, false),
    p_country
  )
  returning * into v_order;

  for v_item in
    select
      pv.id as variant_id,
      pv.product_id,
      pv.size,
      pv.color,
      pv.sku,
      p.name as product_name
    from jsonb_array_elements(p_items) item
    join public.product_variants pv on pv.id = (item->>'variant_id')::uuid
    join public.products p on p.id = pv.product_id
  loop
    insert into public.order_items (
      order_id,
      product_id,
      variant_id,
      product_name,
      size,
      color,
      sku,
      qty
    )
    values (
      v_order.id,
      v_item.product_id,
      v_item.variant_id,
      v_item.product_name,
      v_item.size,
      v_item.color,
      v_item.sku,
      1
    );

    insert into public.stock_movements (
      variant_id,
      movement_type,
      qty,
      order_id,
      comment,
      created_by
    )
    values (
      v_item.variant_id,
      'reserve',
      -1,
      v_order.id,
      'Reserve for merch order',
      v_employee.id
    );
  end loop;

  return jsonb_build_object(
    'id', v_order.id,
    'order_number', v_order.order_number
  );
end;
$$;


-- Source: supabase/runtime.sql
-- Missing runtime behavior reconstructed from the application contract.
-- Lock stock rows so simultaneous orders cannot reserve the same last item.
create or replace function public.apply_stock_movement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v public.product_variants%rowtype; n integer;
begin
  select * into v from public.product_variants where id = new.variant_id for update;
  if not found then raise exception 'variant_not_found'; end if;
  if new.movement_type in ('income','unreserve','return') and new.qty <= 0 then
    raise exception 'positive_stock_quantity_required';
  end if;
  if new.movement_type in ('reserve','write_off') and new.qty >= 0 then
    raise exception 'negative_stock_quantity_required';
  end if;
  if new.movement_type = 'reserve' then
    n := -new.qty;
    if v.total_qty - v.reserved_qty < n then raise exception 'product_is_not_available'; end if;
    update public.product_variants set reserved_qty = reserved_qty + n where id = v.id;
  elsif new.movement_type = 'unreserve' then
    if v.reserved_qty < new.qty then raise exception 'invalid_stock_release'; end if;
    update public.product_variants set reserved_qty = reserved_qty - new.qty where id = v.id;
  elsif new.movement_type = 'write_off' then
    n := -new.qty;
    if new.order_id is not null then
      if v.reserved_qty < n then raise exception 'invalid_stock_write_off'; end if;
      update public.product_variants set total_qty = total_qty - n, reserved_qty = reserved_qty - n where id = v.id;
    else
      update public.product_variants set total_qty = total_qty - n where id = v.id;
    end if;
  else
    update public.product_variants set total_qty = total_qty + new.qty where id = v.id;
  end if;
  return new;
end; $$;
create trigger stock_movement_apply after insert on public.stock_movements
for each row execute function public.apply_stock_movement();

create or replace function public.create_merch_order(
  p_items jsonb, p_delivery_type public.delivery_type, p_delivery_address text,
  p_phone text, p_comment text, p_is_remote boolean, p_country text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.employees%rowtype; a record; o public.orders%rowtype; v record;
  item jsonb; total integer; unique_products integer;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  select * into e from public.employees where id = auth.uid();
  if not found or not e.is_active then raise exception 'employee_not_allowed'; end if;
  select * into a from public.get_employee_merch_access(e.email);
  if not coalesce(a.is_allowed, false) then raise exception '%', coalesce(a.reason,'employee_not_allowed'); end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'cart_is_empty'; end if;
  total := jsonb_array_length(p_items);
  if total = 0 then raise exception 'cart_is_empty'; end if;
  if total > 3 then raise exception 'max_unique_products_exceeded'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    if item->>'variant_id' is null then raise exception 'product_is_not_available'; end if;
    if jsonb_typeof(item->'qty') <> 'number' or (item->>'qty')::numeric is distinct from 1 then
      raise exception 'one_unit_per_product_only';
    end if;
  end loop;
  select count(distinct pv.product_id) into unique_products
    from jsonb_array_elements(p_items) i
    join public.product_variants pv on pv.id = (i->>'variant_id')::uuid;
  if unique_products <> total then raise exception 'one_variant_per_product_only'; end if;
  -- Sorted lock acquisition prevents deadlocks for baskets in different orders.
  perform pv.id from public.product_variants pv
    where pv.id in (select (i->>'variant_id')::uuid from jsonb_array_elements(p_items) i)
    order by pv.id for update;
  for v in select pv.*, p.name as product_name, p.is_active as product_active
    from public.product_variants pv join public.products p on p.id = pv.product_id
    where pv.id in (select (i->>'variant_id')::uuid from jsonb_array_elements(p_items) i)
  loop
    if not v.is_active or not v.product_active or v.total_qty - v.reserved_qty < 1 then
      raise exception 'product_is_not_available';
    end if;
  end loop;
  insert into public.orders(employee_id,delivery_type,delivery_address,full_name,phone,email,city,department,comment,is_remote,country)
    values(e.id,coalesce(p_delivery_type,'office'),p_delivery_address,e.full_name,coalesce(p_phone,e.phone),e.email,e.city,
      coalesce(e.business_unit,e.department),p_comment,coalesce(p_is_remote,false),
      case when p_is_remote then nullif(trim(p_country),'') else null end) returning * into o;
  for v in select pv.*, p.name as product_name from public.product_variants pv
    join public.products p on p.id = pv.product_id
    where pv.id in (select (i->>'variant_id')::uuid from jsonb_array_elements(p_items) i)
    order by pv.id
  loop
    insert into public.order_items(order_id,product_id,variant_id,product_name,size,color,sku,qty)
      values(o.id,v.product_id,v.id,v.product_name,v.size,v.color,v.sku,1);
    insert into public.stock_movements(variant_id,movement_type,qty,order_id,comment,created_by)
      values(v.id,'reserve',-1,o.id,'Reserve for merch order',e.id);
  end loop;
  return jsonb_build_object('id',o.id,'order_number',o.order_number);
end; $$;

-- The old admin function was not provided. Reconstructed lifecycle:
-- reserve on create, write off on shipped/received, release on cancellation,
-- return stock if a shipped order is cancelled. Terminal orders cannot reopen.
create or replace function public.admin_update_order(
  p_order_id uuid, p_status public.order_status, p_admin_comment text, p_tracking_number text
) returns public.orders language plpgsql security definer set search_path = '' as $$
declare o public.orders%rowtype; i record; movement public.movement_type; delta integer;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  if p_status is null then raise exception 'invalid_order_status'; end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if o.status in ('received','cancelled','rejected') and p_status <> o.status then
    raise exception 'terminal_order_cannot_reopen';
  end if;
  if o.status = 'shipped' and p_status in ('new','review','confirmed','assembling') then
    raise exception 'shipped_order_cannot_reopen';
  end if;
  if o.status not in ('shipped','received','cancelled','rejected') and p_status in ('shipped','received') then
    movement := 'write_off'; delta := -1;
  elsif o.status not in ('shipped','received','cancelled','rejected') and p_status in ('cancelled','rejected') then
    movement := 'unreserve'; delta := 1;
  elsif o.status = 'shipped' and p_status in ('cancelled','rejected') then
    movement := 'return'; delta := 1;
  end if;
  if movement is not null then
    for i in select * from public.order_items where order_id = o.id order by variant_id loop
      insert into public.stock_movements(variant_id,movement_type,qty,order_id,comment,created_by)
        values(i.variant_id,movement,delta*i.qty,o.id,'Order status: ' || p_status::text,auth.uid());
    end loop;
  end if;
  update public.orders set status=p_status, admin_comment=p_admin_comment, tracking_number=p_tracking_number,
    confirmed_at=case when p_status='confirmed' then coalesce(confirmed_at,now()) else confirmed_at end,
    shipped_at=case when p_status='shipped' then coalesce(shipped_at,now()) else shipped_at end,
    received_at=case when p_status='received' then coalesce(received_at,now()) else received_at end,
    cancelled_at=case when p_status in ('cancelled','rejected') then coalesce(cancelled_at,now()) else cancelled_at end
    where id=o.id returning * into o;
  return o;
end; $$;

create or replace function public.update_my_profile(
  p_full_name text,p_phone text,p_department text,p_position text,p_city text,p_office text
) returns public.employees language plpgsql security definer set search_path = '' as $$
declare e public.employees%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if nullif(trim(p_full_name),'') is null then raise exception 'full_name_required'; end if;
  update public.employees set full_name=trim(p_full_name),phone=p_phone,department=p_department,
    position=p_position,city=p_city,office=p_office where id=auth.uid() returning * into e;
  if not found then raise exception 'employee_not_found'; end if;
  return e;
end; $$;

-- Restrict the directory lookup to the current user's own email or an admin.
create or replace function public.get_employee_merch_access(p_email text)
returns table(is_allowed boolean,reason text,hired_at date,months_worked integer)
language plpgsql security definer set search_path = '' as $$
declare d public.employee_directory%rowtype;
begin
  if auth.uid() is null or (not public.is_admin() and not exists (
    select 1 from public.employees e where e.id=auth.uid() and lower(e.email)=lower(p_email)
  )) then raise exception 'not_allowed'; end if;
  select * into d from public.employee_directory where lower(email)=lower(p_email);
  return query select
    coalesce(d.is_active and d.hired_at <= (current_date-interval '3 months')::date,false),
    case when d.id is null then 'employee_not_in_directory' when not d.is_active then 'employee_inactive'
      when d.hired_at > current_date-interval '3 months' then 'employee_tenure_too_short' else 'ok' end,
    d.hired_at,
    case when d.hired_at is null then null else
      extract(year from age(current_date,d.hired_at))::integer*12 + extract(month from age(current_date,d.hired_at))::integer end;
end; $$;

create view public.product_variants_available with (security_invoker=true) as
select pv.*, pv.total_qty-pv.reserved_qty as available_qty from public.product_variants pv;

create trigger products_touch_updated_at before update on public.products for each row execute function public.touch_updated_at();
create trigger variants_touch_updated_at before update on public.product_variants for each row execute function public.touch_updated_at();
create trigger carts_touch_updated_at before update on public.carts for each row execute function public.touch_updated_at();

alter table public.employees enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_limits enable row level security;
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.stock_movements enable row level security;

create policy emp_read_own on public.employees for select to authenticated using(id=auth.uid() or public.is_admin());
create policy emp_admin_all on public.employees for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy cat_read on public.categories for select to authenticated using(true);
create policy cat_admin_write on public.categories for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy prod_read on public.products for select to authenticated using(is_active or public.is_admin());
create policy prod_admin_write on public.products for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy var_read on public.product_variants for select to authenticated using(public.is_admin() or (is_active and exists(
  select 1 from public.products p where p.id=product_id and p.is_active)));
create policy var_admin_write on public.product_variants for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy limits_read on public.product_limits for select to authenticated using(true);
create policy limits_admin_write on public.product_limits for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy carts_own on public.carts for all to authenticated using(employee_id=auth.uid()) with check(employee_id=auth.uid());
create policy cart_items_own on public.cart_items for all to authenticated using(exists(
  select 1 from public.carts c where c.id=cart_id and c.employee_id=auth.uid())) with check(exists(
  select 1 from public.carts c where c.id=cart_id and c.employee_id=auth.uid()));
create policy orders_read on public.orders for select to authenticated using(employee_id=auth.uid() or public.is_admin());
create policy order_items_read on public.order_items for select to authenticated using(public.is_admin() or exists(
  select 1 from public.orders o where o.id=order_id and o.employee_id=auth.uid()));
create policy stock_admin_read on public.stock_movements for select to authenticated using(public.is_admin());
create policy stock_admin_insert on public.stock_movements for insert to authenticated
  with check(public.is_admin() and movement_type in ('income','adjustment') and order_id is null and created_by=auth.uid());

-- Supabase default grants can be broad; reset table/function privileges explicitly.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.employees,public.categories,public.products,public.product_variants,
  public.product_variants_available,public.product_limits,public.carts,public.cart_items,
  public.orders,public.order_items,public.stock_movements,public.employee_directory,
  public.employee_audit_log,public.merch_settings to authenticated;
grant insert,update,delete on public.employees,public.categories,public.products,public.product_limits,
  public.carts,public.cart_items,public.employee_directory to authenticated;
grant insert,update on public.merch_settings to authenticated;
grant insert on public.product_variants,public.stock_movements to authenticated;
grant update(size,color,sku,is_active) on public.product_variants to authenticated;
grant execute on function public.is_admin(),public.mark_password_set(),public.get_employee_merch_access(text),
  public.create_merch_order(jsonb,public.delivery_type,text,text,text,boolean,text),
  public.admin_update_order(uuid,public.order_status,text,text),public.admin_set_order_handout(uuid,text,text,text),
  public.update_my_profile(text,text,text,text,text,text) to authenticated;

-- Prevent administrators bypassing the ledger when creating a variant.
create function public.check_initial_stock() returns trigger language plpgsql set search_path='' as $$
begin
  if new.total_qty <> 0 or new.reserved_qty <> 0 then raise exception 'use_stock_movements_for_initial_stock'; end if;
  return new;
end; $$;
create trigger variant_initial_stock before insert on public.product_variants
for each row execute function public.check_initial_stock();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('merch-products','merch-products',true,5242880,array['image/jpeg','image/png','image/webp','image/gif']);
create policy merch_images_read on storage.objects for select to anon,authenticated using(bucket_id='merch-products');
create policy merch_images_admin_insert on storage.objects for insert to authenticated
  with check(bucket_id='merch-products' and public.is_admin());
create policy merch_images_admin_update on storage.objects for update to authenticated
  using(bucket_id='merch-products' and public.is_admin()) with check(bucket_id='merch-products' and public.is_admin());
create policy merch_images_admin_delete on storage.objects for delete to authenticated
  using(bucket_id='merch-products' and public.is_admin());


COMMIT;
