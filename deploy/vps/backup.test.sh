#!/bin/sh
# Test of backup.sh and offsite.sh with fake docker, age, rclone and curl (no database, no network): sh deploy/vps/backup.test.sh
# BACKUP_SH=dash sh deploy/vps/backup.test.sh runs the scripts under dash, the /bin/sh of Ubuntu (signals behave differently).
# STUB_FAIL: dump | restore | truncated | s3 | ftp | smtp
set -u
here=$(cd "$(dirname "$0")" && pwd)
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
mkdir -p "$root/bin"
calls="$root/calls"
cat > "$root/bin/docker" <<'STUB'
#!/bin/sh
case "$*" in
  *pg_dump*)
    [ "${STUB_FAIL:-}" = dump ] && { echo "pg_dump: error" >&2; exit 1; }
    printf 'PGDMP-fake-dump-bytes'
    [ "${STUB_SLOW:-}" = 1 ] && sleep 3
    exit 0 ;;
  *pg_restore*)
    cat > /dev/null
    [ "${STUB_FAIL:-}" = restore ] && { echo "pg_restore: not a dump" >&2; exit 1; }
    [ "${STUB_FAIL:-}" = truncated ] && { echo "pg_restore: unexpected end of file" >&2; exit 1; }
    exit 0 ;;
  *) exit 2 ;;
esac
STUB
cat > "$root/bin/age" <<'STUB'
#!/bin/sh
echo "age $*" >> "$CALLS"
while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift 2 ;; -r) shift 2 ;; *) in=$1; shift ;; esac; done
{ echo AGE-FAKE; cat "$in"; } > "$out"
STUB
cat > "$root/bin/rclone" <<'STUB'
#!/bin/sh
echo "rclone $*" >> "$CALLS"
case "$*" in *s3test:*) [ "${STUB_FAIL:-}" = s3 ] && { echo "rclone: s3 error" >&2; exit 1; } ;; esac
case "$*" in *ftptest:*) [ "${STUB_FAIL:-}" = ftp ] && { echo "rclone: ftp error" >&2; exit 1; } ;; esac
exit 0
STUB
cat > "$root/bin/curl" <<'STUB'
#!/bin/sh
echo "curl $*" >> "$CALLS"
cat > "$CALLS.msg"
while [ $# -gt 0 ]; do case "$1" in -K|--config) cp "$2" "$CALLS.cfg"; shift 2 ;; *) shift ;; esac; done
[ "${STUB_FAIL:-}" = smtp ] && { echo "curl: (67) login denied" >&2; exit 67; }
exit 0
STUB
chmod +x "$root/bin/"*

passed=0; failed=0
check() { if [ "$1" = "$2" ]; then passed=$((passed + 1)); else failed=$((failed + 1)); echo "FAIL: $3 (got '$1', want '$2')"; fi; }
nz() { [ "$1" -ne 0 ] && echo nonzero; }
fresh() { rm -rf "$root/inv" "$root/backups" "$calls"*; mkdir -p "$root/inv" "$root/backups"; echo vaultkey > "$root/inv/pgsodium_root.key"; : > "$calls"; }
seed() { n=$1; i=1; while [ "$i" -le "$n" ]; do f="$root/backups/inventory-202601$(printf '%02d' "$i")-000000.dump"; echo old > "$f"; touch -d "2026-01-$(printf '%02d' "$i")" "$f"; i=$((i + 1)); done; }
# run VAR=value ...: backup.sh under $BACKUP_SH with the stubs first on PATH; output in $root/out
run() { env INV_DIR="$root/inv" BACKUP_DIR="$root/backups" CALLS="$calls" PATH="$root/bin:$PATH" "$@" "${BACKUP_SH:-sh}" "$here/backup.sh" >"$root/out" 2>&1; }
count() { ls -A1 "$root/backups" | wc -l | tr -d ' '; }
ncalls() { grep -c "^$1 " "$calls"; }
dumps() { ls -1 "$root/backups" | grep -c '^inventory-.*\.dump$'; }
leftovers() { ls -A1 "$root/backups" | grep -c 'age\|partial\|offsite'; }
ALL="OFFSITE_ENABLED=1 AGE_RECIPIENT=age1examplepublickeyxxxxxxxx OFFSITE_S3=s3test:bkt/inv OFFSITE_FTP=ftptest:dir OFFSITE_EMAIL_TO=to@example.test OFFSITE_EMAIL_FROM=from@example.test SMTP_URL=smtps://mail.example.test:465 SMTP_USER=mailuser SMTP_PASS=S3cretPass-9z"

# (a) success without off-host: one dump (600), key copied once, no .age
fresh; run; rc=$?
check "$rc" 0 "(a) exit code"
check "$(dumps)" 1 "(a) one dump"
check "$(leftovers)" 0 "(a) no .age or partial left"
check "$(cat "$root/backups/pgsodium_root.key")" vaultkey "(a) Vault key copied"
echo changed > "$root/inv/pgsodium_root.key"; sleep 1; run
check "$(cat "$root/backups/pgsodium_root.key")" vaultkey "(a) Vault key copied only the first time"
check "$(wc -c < "$calls" | tr -d ' ')" 0 "(a) no off-host tool called"
: > "$root/probe"; chmod 600 "$root/probe"
if [ "$(stat -c %a "$root/probe")" = 600 ]; then
  check "$(stat -c %a "$root/backups/$(ls -1 "$root/backups" | grep '^inventory-' | head -n 1)")" 600 "(a) dump mode 600"
  check "$(stat -c %a "$root/backups/pgsodium_root.key")" 600 "(a) key mode 600"
else
  echo "note: this file system ignores chmod; mode checks skipped"
fi

# (b) all three targets
fresh; run $ALL; rc=$?
check "$rc" 0 "(b) exit code"
check "$(ncalls age)" 1 "(b) one age call"
check "$(grep -c '^age -r age1examplepublickeyxxxxxxxx ' "$calls")" 1 "(b) age gets the recipient"
check "$(grep -c '^rclone .*copyto .* s3test:bkt/inv/inventory-.*\.dump\.age$' "$calls")" 1 "(b) rclone to S3"
check "$(grep -c '^rclone .*copyto .* ftptest:dir/inventory-.*\.dump\.age$' "$calls")" 1 "(b) rclone to FTP"
check "$(ncalls rclone)" 2 "(b) two rclone calls"
check "$(ncalls curl)" 1 "(b) one curl call"
check "$(grep -c -- '--mail-rcpt to@example.test' "$calls")" 1 "(b) mail recipient"
check "$(grep -c 'SHA-256: [0-9a-f]\{64\}' "$calls.msg")" 1 "(b) message holds the SHA-256"
check "$(grep -c 'Content-Transfer-Encoding: base64' "$calls.msg")" 1 "(b) base64 attachment"
check "$(grep -c 'S3cretPass-9z' "$calls")" 0 "(b) password not in recorded arguments"
check "$(grep -c 'S3cretPass-9z' "$calls.cfg")" 1 "(b) password reaches curl through the config file"
check "$(leftovers)" 0 "(b) no .age or work dir left"
check "$(dumps)" 1 "(b) local dump kept"

# (c) S3 fails: exit 1, the others still run, dump kept
fresh; run $ALL STUB_FAIL=s3; rc=$?
check "$(nz "$rc")" nonzero "(c) exit code"
check "$(grep -c 'offsite s3: failed' "$root/out")" 1 "(c) log line s3 failed"
check "$(grep -c 'offsite ftp: ok' "$root/out")" 1 "(c) FTP still attempted"
check "$(ncalls curl)" 1 "(c) email still attempted"
check "$(dumps)" 1 "(c) local dump kept"
check "$(leftovers)" 0 "(c) no .age left"

# (d) larger than the cap: no curl
fresh; run $ALL OFFSITE_EMAIL_MAX_MB=0; rc=$?
check "$rc" 0 "(d) exit code (a skip is not a failure)"
check "$(ncalls curl)" 0 "(d) no curl"
check "$(grep -c 'offsite email: skipped (size)' "$root/out")" 1 "(d) log line"

# (e) no recipient: exit 1, nothing uploaded
fresh; run $ALL AGE_RECIPIENT=; rc=$?
check "$(nz "$rc")" nonzero "(e) exit code"
check "$(wc -c < "$calls" | tr -d ' ')" 0 "(e) no age, rclone or curl call"
check "$(dumps)" 1 "(e) local dump kept"

# (f) dump fails, cannot be read back, or is cut: nothing new, nothing rotated, no off-host
for mode in dump restore truncated; do
  fresh; seed 16; run $ALL STUB_FAIL=$mode; rc=$?
  check "$(nz "$rc")" nonzero "(f) exit code, $mode"
  check "$(count)" 16 "(f) no new file and no rotation, $mode"
  check "$(wc -c < "$calls" | tr -d ' ')" 0 "(f) no off-host, $mode"
done

# (g0) a password with $, &, ; and a space survives intact
fresh; run $ALL SMTP_PASS='ab$cd&ef;gh ij'; rc=$?
check "$rc" 0 "(g0) exit code"
check "$(grep -c 'ab$cd&ef;gh ij' "$calls.cfg")" 1 "(g0) password intact in curl config"
check "$(grep -c -e 'gh ij' -e 'ef;gh' -e 'cd&ef' "$root/out")" 0 "(g0) no fragment printed"
# (g) no secret in stdout/stderr, success or SMTP failure
fresh; run $ALL
check "$(grep -c 'S3cretPass-9z' "$root/out")" 0 "(g) password not printed"
fresh; run $ALL STUB_FAIL=smtp; rc=$?
check "$(nz "$rc")" nonzero "(g) exit code on SMTP failure"
check "$(grep -c 'offsite email: failed' "$root/out")" 1 "(g) log line email failed"
check "$(grep -c 'S3cretPass-9z' "$root/out")" 0 "(g) password not printed on failure"
check "$(grep -c 'S3cretPass-9z' "$calls")" 0 "(g) password not in arguments on failure"

# (h) units
svc="$here/endpoint-inventory-backup.service"; tmr="$here/endpoint-inventory-backup.timer"
check "$(grep -c '^EnvironmentFile=-/opt/endpoint-inventory/backup.env' "$svc")" 1 "(h) service reads backup.env"
check "$(grep -c '^Type=oneshot' "$svc")" 1 "(h) oneshot"
check "$(grep -c '^ExecStart=/opt/endpoint-inventory/backup.sh' "$svc")" 1 "(h) ExecStart"
check "$(grep -c '^OnCalendar=\*-\*-\* 03:45:00 UTC' "$tmr")" 1 "(h) timer 03:45 UTC"
check "$(grep -c '^Persistent=true' "$tmr")" 1 "(h) persistent"

# (i) rotation keeps the newest 14 after a success; SIGTERM during the dump leaves no partial file and rotates nothing
fresh; seed 16; run
check "$(dumps)" 14 "(i) 14 dumps remain"
fresh; seed 16
env INV_DIR="$root/inv" BACKUP_DIR="$root/backups" CALLS="$calls" PATH="$root/bin:$PATH" STUB_SLOW=1 "${BACKUP_SH:-sh}" "$here/backup.sh" >/dev/null 2>&1 &
pid=$!
sleep 1; kill -TERM "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
sleep 4
check "$(ls "$root/backups" | grep -c 'partial')" 0 "(i) no .partial after SIGTERM"
check "$(dumps)" 16 "(i) nothing rotated after SIGTERM"

echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
