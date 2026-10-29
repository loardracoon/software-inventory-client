#!/usr/bin/env bash
# Puts the database back to a dump made by backup.sh: ./restore.sh backups/<file>.dump [--yes]
# Everything written after the dump is lost. The app services stop during the restore (the database keeps
# running), then start again. Restore only into the install that made the dump (its Vault key).
set -euo pipefail
cd "$(dirname "$0")"
file=${1:-}
[ -f "$file" ] || { echo "Usage: ./restore.sh backups/<file>.dump [--yes]"; exit 2; }
if [ "${2:-}" != "--yes" ]; then
  read -r -p "Replace the database with $file? Everything after it is lost. Type yes: " answer
  [ "$answer" = "yes" ] || { echo "Nothing changed"; exit 1; }
fi
echo "Stopping the app services"
docker compose stop caddy kong functions auth rest
echo "Restoring $file"
docker compose exec -T db pg_restore -U supabase_admin -h localhost -d postgres --clean --if-exists --exit-on-error < "$file"
echo "Starting the app services"
docker compose up -d --wait
echo "Restored $file"
