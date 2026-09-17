#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
 --set=inventory_password="$INVENTORY_DB_PASSWORD" --set=production_password="$PRODUCTION_DB_PASSWORD" --set=finance_password="$FINANCE_DB_PASSWORD" --set=identity_password="$IDENTITY_DATABASE_PASSWORD" <<'SQL'
CREATE ROLE inventory_user LOGIN PASSWORD :'inventory_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE production_user LOGIN PASSWORD :'production_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE finance_user LOGIN PASSWORD :'finance_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE identity_user LOGIN PASSWORD :'identity_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE DATABASE ambrosia_inventory OWNER inventory_user;
CREATE DATABASE ambrosia_production OWNER production_user;
CREATE DATABASE ambrosia_finance_reports OWNER finance_user;
CREATE DATABASE ambrosia_identity OWNER identity_user;
REVOKE ALL ON DATABASE postgres FROM PUBLIC;
REVOKE ALL ON DATABASE template1 FROM PUBLIC;
REVOKE ALL ON DATABASE ambrosia_inventory FROM PUBLIC;
REVOKE ALL ON DATABASE ambrosia_production FROM PUBLIC;
REVOKE ALL ON DATABASE ambrosia_finance_reports FROM PUBLIC;
REVOKE ALL ON DATABASE ambrosia_identity FROM PUBLIC;
\connect ambrosia_inventory
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO inventory_user;
\connect ambrosia_production
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO production_user;
\connect ambrosia_finance_reports
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO finance_user;
\connect ambrosia_identity
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO identity_user;
SQL
