#!/bin/sh
set -eu
case "$IDENTITY_DATABASE_USER" in (*[!a-z0-9_]*|'') echo 'IDENTITY_DATABASE_USER inválido' >&2; exit 1;; esac
case "$IDENTITY_DATABASE_NAME" in (*[!a-z0-9_]*|'') echo 'IDENTITY_DATABASE_NAME inválido' >&2; exit 1;; esac
export PGPASSWORD="$POSTGRES_ADMIN_PASSWORD"
psql -v ON_ERROR_STOP=1 -h postgres -U "$POSTGRES_ADMIN_USER" -d postgres \
  --set=identity_user="$IDENTITY_DATABASE_USER" --set=identity_password="$IDENTITY_DATABASE_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', :'identity_user', :'identity_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'identity_user') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', :'identity_user', :'identity_password') \gexec
SQL
if ! psql -h postgres -U "$POSTGRES_ADMIN_USER" -d postgres -At -c "SELECT 1 FROM pg_database WHERE datname='$IDENTITY_DATABASE_NAME'" | grep -q 1; then
  createdb -h postgres -U "$POSTGRES_ADMIN_USER" --owner="$IDENTITY_DATABASE_USER" "$IDENTITY_DATABASE_NAME"
fi
psql -v ON_ERROR_STOP=1 -h postgres -U "$POSTGRES_ADMIN_USER" -d postgres \
  --set=db="$IDENTITY_DATABASE_NAME" --set=identity_user="$IDENTITY_DATABASE_USER" <<'SQL'
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db') \gexec
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I', :'db', :'identity_user') \gexec
SQL
psql -v ON_ERROR_STOP=1 -h postgres -U "$POSTGRES_ADMIN_USER" -d "$IDENTITY_DATABASE_NAME" --set=identity_user="$IDENTITY_DATABASE_USER" <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SELECT format('GRANT ALL ON SCHEMA public TO %I', :'identity_user') \gexec
SQL
