#!/bin/sh
# Encrypts a backup file with age (public key only) and sends the .age copy to each configured target. Called by backup.sh.
#   offsite.sh FILE
# Settings (from the environment; the unit loads backup.env): AGE_RECIPIENT (age1... public key, required), OFFSITE_S3 and OFFSITE_FTP (rclone paths,
# remotes in $INV_DIR/rclone.conf), OFFSITE_EMAIL_TO + OFFSITE_EMAIL_FROM + SMTP_URL + SMTP_USER + SMTP_PASS,
# OFFSITE_EMAIL_MAX_MB (20), OFFSITE_SEND_KEY=1 (also send pgsodium_root.key, encrypted the same way; default 0).
# Every target logs "offsite <target>: ok|failed"; exit 1 if any failed. The plain dump never leaves the host; no secret is printed.
set -eu
umask 077
file=${1:?usage: offsite.sh FILE}
INV_DIR=${INV_DIR:-/opt/endpoint-inventory}
RCLONE_CONF=${RCLONE_CONF:-$INV_DIR/rclone.conf}
OFFSITE_EMAIL_MAX_MB=${OFFSITE_EMAIL_MAX_MB:-20}
case $OFFSITE_EMAIL_MAX_MB in ''|*[!0-9]*|0) echo "OFFSITE_EMAIL_MAX_MB must be a whole number >= 1" >&2; exit 1 ;; esac

case "${AGE_RECIPIENT:-}" in
  age1*) ;;
  *) echo "AGE_RECIPIENT missing or not an age1 public key: nothing sent off the host" >&2; exit 1 ;;
esac

# Work dir (encrypted copies, mail message, curl config) in the backups dir, removed on exit and on signals.
work=$(mktemp -d "$(dirname "$file")/.offsite.XXXXXX")
trap 'rm -rf "$work"' EXIT
trap 'exit 1' INT TERM HUP

bad=0
esc() { printf '%s' "$1" | sed 's/[\\"]/\\&/g'; }

# send_mail FILE.age: one MIME message; the password goes to curl in a config file (not visible in ps)
send_mail() {
  name=$(basename "$1")
  sum=$(sha256sum "$1" | cut -d' ' -f1)
  size=$(wc -c < "$1" | tr -d ' ')
  b="inventory-backup-$sum"
  host=${OFFSITE_EMAIL_FROM##*@}; host=${host%%>*}
  {
    # Date and Message-ID (RFC 5322): without them spam filters can drop the copy while the log says ok.
    printf 'From: %s\nTo: %s\nDate: %s\nMessage-ID: <backup.%.16s@%s>\n' "$OFFSITE_EMAIL_FROM" "$OFFSITE_EMAIL_TO" "$(date -R)" "$sum" "$host"
    printf 'Subject: Endpoint Inventory backup %s\nMIME-Version: 1.0\n' "$name"
    printf 'Content-Type: multipart/mixed; boundary="%s"\n\n--%s\nContent-Type: text/plain; charset=us-ascii\n\n' "$b" "$b"
    printf 'Encrypted backup (age) attached.\nFile: %s\nSize: %s bytes\nSHA-256: %s\n\n' "$name" "$size" "$sum"
    printf -- '--%s\nContent-Type: application/octet-stream\nContent-Transfer-Encoding: base64\n' "$b"
    printf 'Content-Disposition: attachment; filename="%s"\n\n' "$name"
    base64 < "$1"
    printf -- '\n--%s--\n' "$b"
  } | sed 's/$/\r/' > "$work/msg" &&
  printf 'user = "%s:%s"\n' "$(esc "$SMTP_USER")" "$(esc "$SMTP_PASS")" > "$work/curl.cfg" &&
  curl -sS --ssl-reqd --max-time 1800 --url "$SMTP_URL" --config "$work/curl.cfg" --mail-from "$OFFSITE_EMAIL_FROM" \
    --mail-rcpt "$OFFSITE_EMAIL_TO" --upload-file - < "$work/msg"
}

# ship FILE.age: every configured target; a failed target sets bad=1 and the others still run
ship() {
  name=$(basename "$1")
  for pair in "s3:${OFFSITE_S3:-}" "ftp:${OFFSITE_FTP:-}"; do
    target=${pair#*:}
    [ -n "$target" ] || continue
    if rclone --config "$RCLONE_CONF" copyto "$1" "$target/$name"; then echo "offsite ${pair%%:*}: ok"
    else echo "offsite ${pair%%:*}: failed"; bad=1; fi
  done
  [ -n "${OFFSITE_EMAIL_TO:-}" ] || return 0
  if [ -z "${OFFSITE_EMAIL_FROM:-}" ] || [ -z "${SMTP_URL:-}" ] || [ -z "${SMTP_USER:-}" ] || [ -z "${SMTP_PASS:-}" ]; then
    echo "offsite email: failed (incomplete settings)"; bad=1; return 0
  fi
  # shortcut: the cap is on the encrypted file; base64 adds about a third, so keep the cap below the mail server limit.
  if [ "$(wc -c < "$1" | tr -d ' ')" -gt $((OFFSITE_EMAIL_MAX_MB * 1048576)) ]; then
    echo "offsite email: skipped (size)"
  elif send_mail "$1"; then echo "offsite email: ok"
  else echo "offsite email: failed"; bad=1; fi
}

age -r "$AGE_RECIPIENT" -o "$work/$(basename "$file").age" "$file"
ship "$work/$(basename "$file").age"

key="$(dirname "$file")/pgsodium_root.key"
if [ "${OFFSITE_SEND_KEY:-0}" = 1 ] && [ -f "$key" ]; then
  age -r "$AGE_RECIPIENT" -o "$work/pgsodium_root.key.age" "$key"
  ship "$work/pgsodium_root.key.age"
fi
exit "$bad"
