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
