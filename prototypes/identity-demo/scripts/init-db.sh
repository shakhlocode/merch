#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 --set=app_password="$DEMO_DB_PASSWORD" <<'SQL'
select format('create role merch_demo login password %L nosuperuser nocreatedb nocreaterole nobypassrls', :'app_password') \gexec
alter database merch_identity_demo owner to merch_demo;
SQL
