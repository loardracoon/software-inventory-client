#!/bin/sh
# Applies the supabase/migrations/*.sql files not yet recorded in supabase_migrations.schema_migrations, in
# order, each in one transaction together with its record. Run by the Argo CD PreSync Job before each rollout.
set -eu

psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 \
  -c "create schema if not exists supabase_migrations" \
  -c "create table if not exists supabase_migrations.schema_migrations (version text primary key, name text, applied_at timestamptz not null default now())"
applied=$(psql "$DATABASE_URL" -tA -c "select version from supabase_migrations.schema_migrations")

count=0
for file in /migrations/*.sql; do
  base=$(basename "$file" .sql)
  version=${base%%_*}
  name=${base#*_}
  if printf '%s\n' "$applied" | grep -qx "$version"; then
    continue
  fi
  echo "Applying $base"
  psql "$DATABASE_URL" -q -1 -v ON_ERROR_STOP=1 -f "$file" \
    -c "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name')"
  count=$((count + 1))
done

psql "$DATABASE_URL" -q -c "notify pgrst, 'reload schema'"
echo "$count migration(s) applied"
