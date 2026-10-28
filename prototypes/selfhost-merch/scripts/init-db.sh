#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 --set=app_password="$DEMO_DB_PASSWORD" --set=migrator_password="$DEMO_MIGRATOR_PASSWORD" --set=retention_password="$DEMO_RETENTION_PASSWORD" <<'SQL'
select format('create role merch_migrator login password %L nosuperuser nocreatedb nocreaterole nobypassrls', :'migrator_password') \gexec
select format('create role merch_app login password %L nosuperuser nocreatedb nocreaterole nobypassrls', :'app_password') \gexec
select format('create role merch_retention login password %L nosuperuser nocreatedb nocreaterole nobypassrls', :'retention_password') \gexec
alter database merch_selfhost_demo owner to merch_migrator;
revoke create on schema public from public;
grant usage,create on schema public to merch_migrator;
grant usage on schema public to merch_app,merch_retention;
SQL
