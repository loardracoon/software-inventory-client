#!/usr/bin/env bash
# One-command install of Endpoint Inventory on one host (docs/operations.md › Deploy on one host).
#
#   ./install.sh --domain inventory.example.com      HTTPS with Let's Encrypt (ports 80 and 443 reach this host)
#   ./install.sh --http-port 8080                    plain HTTP on http://<this host>:8080 (lab or laptop)
#
# Options:
#   --domain NAME          public name for HTTPS (Let's Encrypt)
#   --http-port N          HTTP port (default 80); --host NAME sets the name in the links (default: this host's name)
#   --smtp-host H --smtp-port P --smtp-user U --smtp-pass P --smtp-from ADDR
#                          real email for sign-in links (default: Mailpit, read the emails at /mail/)
#   --tag SHA              image tag (default: the one CI deployed on main)
#   --auto-update          install systemd timers: update.sh every 15 minutes, backup.sh daily (Linux, root)
#
# Safe to run again: the secrets in .env are kept; only missing values are added. The database and the Vault
# secrets are set up the same way each time.
set -euo pipefail
cd "$(dirname "$0")"

REPO=loardracoon/software-inventory-client
domain="" http_port="" host_name="" tag="" auto_update=0
smtp_host="" smtp_port="" smtp_user="" smtp_pass="" smtp_from=""
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) domain=$2; shift 2 ;;
    --http-port) http_port=$2; shift 2 ;;
    --host) host_name=$2; shift 2 ;;
    --tag) tag=$2; shift 2 ;;
    --smtp-host) smtp_host=$2; shift 2 ;;
    --smtp-port) smtp_port=$2; shift 2 ;;
    --smtp-user) smtp_user=$2; shift 2 ;;
    --smtp-pass) smtp_pass=$2; shift 2 ;;
    --smtp-from) smtp_from=$2; shift 2 ;;
    --auto-update) auto_update=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)"; exit 2 ;;
  esac
done

say() { printf '\n== %s\n' "$*"; }
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

# --- Checks ------------------------------------------------------------------------------------------------------
say "Checking the host"
for cmd in docker openssl curl; do command -v "$cmd" >/dev/null || fail "$cmd is not installed"; done
compose_version=$(docker compose version --short 2>/dev/null) || fail "Docker Compose v2 is not installed"
case "$compose_version" in
  1.*|2.[0-9].*|2.1[0-9].*|2.2[0-3].*) fail "Docker Compose $compose_version is too old (2.24 or later needed)" ;;
esac
docker info >/dev/null 2>&1 || fail "cannot talk to Docker (is the daemon running, and may this user use it?)"
echo "Docker Compose $compose_version"

# --- .env --------------------------------------------------------------------------------------------------------
umask 077
touch .env
chmod 600 .env
get() { sed -n "s/^$1=//p" .env | head -n 1; }
put() { # put KEY VALUE: set or replace one line
  local tmp
  tmp=$(mktemp)
  grep -v "^$1=" .env > "$tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  cat "$tmp" > .env
  rm -f "$tmp"
}
keep() { [ -n "$(get "$1")" ] || put "$1" "$2"; } # keep KEY VALUE: only when missing
rand() { openssl rand -hex "$1"; }
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
jwt() { # jwt ROLE SECRET: HS256 token valid for 10 years, as Supabase uses for anon and service_role
  local now header payload sig
  now=$(date +%s)
  header=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
  payload=$(printf '{"role":"%s","iss":"supabase","iat":%s,"exp":%s}' "$1" "$now" "$((now + 315360000))" | b64url)
  sig=$(printf '%s.%s' "$header" "$payload" | openssl dgst -sha256 -hmac "$2" -binary | b64url)
  printf '%s.%s.%s' "$header" "$payload" "$sig"
}

say "Writing .env (chmod 600; never commit it)"
if [ -n "$domain" ]; then
  put SITE_ADDRESS "$domain"
  put PUBLIC_URL "https://$domain"
  put HTTP_PORT 80
  put HTTPS_PORT 443
elif [ -n "$http_port" ] || [ -z "$(get PUBLIC_URL)" ]; then
  port=${http_port:-80}
  name=${host_name:-$(hostname -f 2>/dev/null || hostname)}
  put SITE_ADDRESS "http://:80"
  put PUBLIC_URL "http://$name$([ "$port" = 80 ] || printf ':%s' "$port")"
  put HTTP_PORT "$port"
  # Caddy does not use 443 in HTTP mode; keep the mapping off any port in use.
  keep HTTPS_PORT 8443
fi
if [ -z "$tag" ] && [ -z "$(get APP_TAG)" ]; then
  tag=$(curl -fsS "https://raw.githubusercontent.com/$REPO/main/deploy/k3s/app/stack.yaml" \
    | sed -n "s#.*image: ghcr.io/$REPO-web:\([0-9a-f]\{40\}\).*#\1#p" | head -n 1)
  [ -n "$tag" ] || fail "could not read the current image tag from GitHub (use --tag)"
fi
[ -z "$tag" ] || put APP_TAG "$tag"
keep POSTGRES_PASSWORD "$(rand 24)"
keep JWT_SECRET "$(rand 32)"
keep ANON_KEY "$(jwt anon "$(get JWT_SECRET)")"
keep SERVICE_ROLE_KEY "$(jwt service_role "$(get JWT_SECRET)")"
keep COLLECTOR_SECRET "$(rand 32)"
keep MAIL_USER mail
keep MAIL_PASSWORD "$(rand 12)"
if [ -n "$smtp_host" ]; then
  put SMTP_HOST "$smtp_host"
  put SMTP_PORT "${smtp_port:-465}"
  put SMTP_USER "$smtp_user"
  put SMTP_PASS "$smtp_pass"
  put SMTP_FROM "${smtp_from:-$smtp_user}"
fi
# Mailpit page (/mail/) behind basic auth.
printf '%s:%s\n' "$(get MAIL_USER)" "$(openssl passwd -apr1 "$(get MAIL_PASSWORD)")" > mail.htpasswd
chmod 644 mail.htpasswd
echo "Address: $(get PUBLIC_URL)   Image tag: $(get APP_TAG)"

# --- Database ----------------------------------------------------------------------------------------------------
say "Pulling the images"
docker compose pull -q

say "Starting the database"
docker compose up -d --wait db

say "Setting the database role passwords and the JWT secret"
docker compose exec -T db psql -U supabase_admin -h localhost -d postgres -q -v ON_ERROR_STOP=1 \
  -v pw="$(get POSTGRES_PASSWORD)" -v jwt="$(get JWT_SECRET)" <<'SQL'
alter role authenticator with password :'pw';
alter role supabase_auth_admin with password :'pw';
alter role postgres with password :'pw';
alter database postgres set "app.settings.jwt_secret" to :'jwt';
alter database postgres set "app.settings.jwt_exp" to '3600';
SQL

say "Applying the migrations"
docker compose run --rm migrate

say "Starting every service"
docker compose up -d --wait

say "Turning on the scheduled jobs (Vault secrets of the collector)"
docker compose exec -T db psql -U postgres -h localhost -d postgres -q -o /dev/null -v ON_ERROR_STOP=1 \
  -v secret="$(get COLLECTOR_SECRET)" <<'SQL'
select vault.update_secret(id, 'http://kong:8000/functions/v1/collector') from vault.secrets where name = 'collector_url';
select vault.create_secret('http://kong:8000/functions/v1/collector', 'collector_url')
where not exists (select 1 from vault.secrets where name = 'collector_url');
select vault.update_secret(id, :'secret') from vault.secrets where name = 'collector_secret';
select vault.create_secret(:'secret', 'collector_secret')
where not exists (select 1 from vault.secrets where name = 'collector_secret');
SQL

# --- Automatic updates and backups -------------------------------------------------------------------------------
if [ "$auto_update" = 1 ]; then
  say "Installing the update and backup timers"
  command -v systemctl >/dev/null || fail "--auto-update needs systemd"
  [ "$(id -u)" = 0 ] || fail "--auto-update needs root (sudo)"
  dir=$(pwd)
  for job in update backup; do
    cat > "/etc/systemd/system/endpoint-inventory-$job.service" <<UNIT
[Unit]
Description=Endpoint Inventory $job ($dir/$job.sh)
After=docker.service

[Service]
Type=oneshot
ExecStart=$dir/$job.sh
UNIT
  done
  cat > /etc/systemd/system/endpoint-inventory-update.timer <<'UNIT'
[Unit]
Description=Endpoint Inventory: follow the build CI deploys on main

[Timer]
OnBootSec=5min
OnUnitActiveSec=15min

[Install]
WantedBy=timers.target
UNIT
  cat > /etc/systemd/system/endpoint-inventory-backup.timer <<'UNIT'
[Unit]
Description=Endpoint Inventory: daily database dump

[Timer]
OnCalendar=*-*-* 03:15:00
Persistent=true

[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now endpoint-inventory-update.timer endpoint-inventory-backup.timer
fi

# --- Check -------------------------------------------------------------------------------------------------------
say "Checking the app"
url=$(get PUBLIC_URL)
probe="http://localhost:$(get HTTP_PORT)"
[ -z "$domain" ] || probe="$url"
ok=0
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "$probe/auth/v1/health" -H "Host: ${domain:-localhost}"; then ok=1; break; fi
  sleep 2
done
[ "$ok" = 1 ] && echo "Auth answers through Caddy and the gateway." || echo "Not reachable yet at $probe (a new certificate can take a minute; see: docker compose logs caddy)."

cat <<DONE

Endpoint Inventory is running at $url

1. Open it and sign in with your email. The first account of a new install becomes the admin.
$( [ -n "$(get SMTP_HOST)" ] && printf '   The sign-in link arrives by email.' || printf '   Read the sign-in link in Mailpit: %s/mail/  (user %s, password in .env as MAIL_PASSWORD)' "$url" "$(get MAIL_USER)" )
2. Settings › Sophos Central: add the API credential. Settings › Dictionary Hub: add the Hub URL and client key.
3. Updates: ./update.sh (or --auto-update for a timer). Backups: ./backup.sh. Limits: rate-limits.env.
DONE
