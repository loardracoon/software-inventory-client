#!/usr/bin/env bash
# Removes Endpoint Inventory from this host (docs/operations.md › Deploy on one host).
#
#   ./uninstall.sh                  stop and remove the containers and the timers; KEEP the data (database and
#                                   certificate volumes), .env and backups/: ./install.sh brings it back as it was
#   ./uninstall.sh --purge          also delete the database and the other volumes, .env, mail.htpasswd and the
#                                   images: everything is gone (backups/ stays; make one first with ./backup.sh)
#   ./uninstall.sh --purge --purge-backups   also delete backups/
#   --yes                           no question (for scripts)
#
# The timers (install.sh --auto-update) are removed only as root.
set -euo pipefail
cd "$(dirname "$0")"

purge=0 purge_backups=0 yes=0
while [ $# -gt 0 ]; do
  case "$1" in
    --purge) purge=1; shift ;;
    --purge-backups) purge_backups=1; shift ;;
    --yes) yes=1; shift ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)"; exit 2 ;;
  esac
done
[ "$purge_backups" = 0 ] || [ "$purge" = 1 ] || { echo "--purge-backups needs --purge"; exit 2; }
[ -f .env ] || { echo "No .env here: nothing installed from this folder"; exit 1; }

if [ "$yes" = 0 ]; then
  if [ "$purge" = 1 ]; then
    echo "This deletes the database and every setting of this install$([ "$purge_backups" = 1 ] && printf ', and the backups'). It cannot be undone."
    read -r -p "Type delete to continue: " answer
    [ "$answer" = "delete" ] || { echo "Nothing changed"; exit 1; }
  else
    read -r -p "Stop and remove the containers (the data is kept)? Type yes: " answer
    [ "$answer" = "yes" ] || { echo "Nothing changed"; exit 1; }
  fi
fi

# Timers from install.sh --auto-update.
for unit in endpoint-inventory-update endpoint-inventory-backup; do
  if [ -f "/etc/systemd/system/$unit.timer" ]; then
    if [ "$(id -u)" = 0 ]; then
      systemctl disable --now "$unit.timer" >/dev/null 2>&1 || true
      rm -f "/etc/systemd/system/$unit.timer" "/etc/systemd/system/$unit.service"
      echo "Removed the timer $unit"
    else
      echo "The timer $unit stays: run again as root to remove it"
    fi
  fi
done
command -v systemctl >/dev/null && [ "$(id -u)" = 0 ] && systemctl daemon-reload || true

if [ "$purge" = 1 ]; then
  docker compose --profile tools down --volumes --remove-orphans --rmi all
  rm -f .env .env.bak mail.htpasswd
  [ "$purge_backups" = 0 ] || rm -rf backups
  echo "Endpoint Inventory is removed with its data$([ "$purge_backups" = 1 ] && printf ' and backups')."
else
  docker compose --profile tools down --remove-orphans
  echo "Endpoint Inventory is removed; the data, .env and backups/ are kept. ./install.sh starts it again."
fi
