create table if not exists demo_employees (
 id uuid primary key,
 corporate_subject text unique, full_name text not null, email text,
 unit text not null check(unit in ('ecom','fintech','technologies')),
 scope text not null check(scope in ('catalog','welcome')),
 active boolean not null default true
);
create table if not exists demo_users (
 id uuid primary key, employee_id uuid unique not null references demo_employees,
 issuer text, subject text, unique(issuer,subject)
);
create table if not exists demo_sessions (
 token_hash text primary key, user_id uuid not null references demo_users,
 csrf text not null, method text not null check(method in ('oidc','identifier')),
 issuer text, idp_sid text, expires_at timestamptz not null
);
create table if not exists demo_flows (
 state_hash text primary key, verifier text not null, nonce text not null,
 expires_at timestamptz not null
);
create table if not exists demo_invites (
 id uuid primary key, employee_id uuid not null references demo_employees,
 token_hash text unique not null, code_hash text not null,
 claimed_at timestamptz, attempts integer not null default 0,
 expires_at timestamptz not null
);
create table if not exists demo_orders (
 id uuid primary key, user_id uuid not null references demo_users,
 unit text not null, scope text not null, snapshot jsonb not null,
 created_at timestamptz not null default now()
);
create table if not exists demo_events (
 id bigint generated always as identity primary key, created_at timestamptz default now(),
 kind text not null, detail text not null
);
create table if not exists demo_logout_tokens (jti text primary key, expires_at timestamptz not null);
