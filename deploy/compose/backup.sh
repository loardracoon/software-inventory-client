#!/usr/bin/env bash
# Dumps the database to backups/inventory-<UTC time>.dump (pg_dump custom format, as supabase_admin so the
# Auth, Vault and pg_cron objects are included) and keeps the newest KEEP files (default 14). Run daily by
# endpoint-inventory-backup.timer (install.sh --auto-update) or by hand. Restore with ./restore.sh <file>.
# The Vault secrets in a dump are encrypted with this install's key: restore into this install, not another.
set -euo pipefail
cd "$(dirname "$0")"
keep=${KEEP:-14}
mkdir -p backups
chmod 700 backups
file="backups/inventory-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose exec -T db pg_dump -U supabase_admin -h localhost -d postgres -Fc > "$file.part"
mv "$file.part" "$file"
chmod 600 "$file"
ls -1t backups/inventory-*.dump | tail -n "+$((keep + 1))" | xargs -r rm -f
echo "Backup: $file ($(du -h "$file" | cut -f1)); $(ls -1 backups/inventory-*.dump | wc -l) kept"
