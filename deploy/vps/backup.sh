#!/bin/sh
# Daily backup of the Endpoint Inventory database on the VPS (ISO 27001 A.8.13, NIST CP-9). Run by endpoint-inventory-backup.timer.
#   INV_DIR      install dir (default /opt/endpoint-inventory)
#   BACKUP_DIR   where dumps go (default $INV_DIR/backups, files mode 600)
#   KEEP         how many local dumps to keep (default 14)
#   OFFSITE_ENABLED=1  then offsite.sh sends an age-encrypted copy to the targets set in backup.env
# A dump is accepted only after pg_restore can read all of it (a full read, not just the table of contents). On any failure,
# also SIGTERM from systemctl stop or a reboot, no partial file stays and nothing is rotated, so a bad night never removes
# the last good dump. The dump holds personal data and the Vault: keep it private.
# The Vault key (pgsodium_root.key) is not in a dump: it is copied next to the dumps once, and must be kept off the host too.
set -eu
umask 077
INV_DIR=${INV_DIR:-/opt/endpoint-inventory}
BACKUP_DIR=${BACKUP_DIR:-$INV_DIR/backups}
KEEP=${KEEP:-14}
here=$(cd "$(dirname "$0")" && pwd)

mkdir -p "$BACKUP_DIR"
stamp=$(date -u +%Y%m%d-%H%M%S)
final="$BACKUP_DIR/inventory-$stamp.dump"
partial="$final.partial"
trap 'rm -f "$partial"' EXIT
# dash does not run the EXIT trap when a signal ends it: turn the signals into a normal exit.
trap 'exit 1' INT TERM HUP

cd "$INV_DIR"
docker compose exec -T db pg_dump -U supabase_admin -h localhost -d postgres -Fc > "$partial"
docker compose exec -T db pg_restore -f /dev/null < "$partial"
mv "$partial" "$final"
chmod 600 "$final"
echo "Backup written: $final"

if [ -f "$INV_DIR/pgsodium_root.key" ] && [ ! -f "$BACKUP_DIR/pgsodium_root.key" ]; then
  cp "$INV_DIR/pgsodium_root.key" "$BACKUP_DIR/pgsodium_root.key"
  chmod 600 "$BACKUP_DIR/pgsodium_root.key"
fi

# Rotation, only after a good dump.
ls -1t "$BACKUP_DIR"/inventory-*.dump | tail -n "+$((KEEP + 1))" | xargs -r rm -f

# Off-host copy: the local dump counts even if it fails, but offsite.sh then exits non-zero so systemctl shows it.
if [ "${OFFSITE_ENABLED:-0}" = 1 ]; then
  exec "$here/offsite.sh" "$final"
fi
