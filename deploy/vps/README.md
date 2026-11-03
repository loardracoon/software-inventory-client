# Endpoint Inventory on the VPS (next to Mailu and the Dictionary Hub)

> This folder is the production host of the client since 2026-11-03 (it replaced the K3S deployment). For a new
> install on one host, use `deploy/compose` (one command; [README › Install](../../README.md#install)).

`https://inventory.sophizo.com.br` — Docker Compose project `endpoint-inventory` in `/opt/endpoint-inventory`,
beside Mailu (`/mailu`, keeps `mail.sophizo.com.br`) and the Dictionary Hub (`/opt/dictionary-hub`,
`https://mcs.sophizo.com.br`). Only port **18444** is published.

The name goes through Cloudflare (proxied record). A Cloudflare **Origin Rule** sends `inventory.sophizo.com.br`
to port 18444 of the VPS, SSL mode is **Full (strict)**, and the Hostinger firewall allows TCP 18444 from
Cloudflare's ranges.

| Service | What it is |
| --- | --- |
| `db` | Postgres (`supabase/postgres:17.11.0.006`), volume `endpoint-inventory_db-data`, Vault key `./pgsodium_root.key` |
| `auth`, `rest` | GoTrue and PostgREST; sign-ups gated by access rules |
| `functions` | `ghcr.io/loardracoon/software-inventory-client-functions:<APP_TAG>` (collector, sync, probes, Hub sync, alerts) |
| `kong` | `ghcr.io/loardracoon/software-inventory-client-web:<APP_TAG>` — console + API gateway (same image as K3S) |
| `tls` | nginx on `APP_PORT` (18444): `inventory.sophizo.com.br` with the Cloudflare Origin CA certificate (`./certs/inventory.pem`, `inventory.key`), client address from `CF-Connecting-IP` only from Cloudflare's ranges; any other name is refused in the handshake |
| `smtp-relay` | socat answering as `mail.sophizo.com.br:465` and forwarding to Mailu's `front:465` on `mailu_default`; sign-in links come from the mailbox `client-noreply@sophizo.com.br` |
| `migrate` | profile `tools`: `docker compose run --rm migrate` applies new migrations |

The collector runs from pg_cron inside the database every 5 minutes; it calls `http://kong:8000/functions/v1/collector`
with the Vault secrets `collector_url` and `collector_secret` (= `COLLECTOR_SECRET`). The Hub is reached at its
public address `https://mcs.sophizo.com.br`.

## Files

- From this folder: `docker-compose.yml`, `tls.conf`, `rate-limits.env`, `update.sh`, the two systemd units;
  `mail.htpasswd` empty.
- Never committed (chmod 600): `.env` (`PUBLIC_URL`, `APP_PORT`, `APP_TAG`, `POSTGRES_PASSWORD`, `JWT_SECRET`,
  `ANON_KEY`, `SERVICE_ROLE_KEY`, `COLLECTOR_SECRET`, `SOPHOS_LES_URL`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`),
  `pgsodium_root.key` (owner uid 100), `certs/inventory.pem`, `certs/inventory.key`.
- When Cloudflare's IP ranges change (<https://www.cloudflare.com/ips/>), update the `set_real_ip_from` lines in
  `tls.conf`.

## Vault key

The Vault (Sophos credential, Hub key, alert channels, cron secrets) is encrypted with `pgsodium_root.key`. The
file is mounted read-only, so a recreated database container keeps it. Copy it off the host with `.env`: a
database dump cannot open the Vault without it.

## Updates

`update.sh` reads the image tag CI wrote into `deploy/k3s/app/stack.yaml` on `main`; when it differs from
`APP_TAG` it pulls the images, runs the migrations and recreates `functions` and `kong`.
`endpoint-inventory-update.timer` runs it every 5 minutes (`journalctl -u endpoint-inventory-update.service`).
Changes to `docker-compose.yml` or `tls.conf` are copied to the server by hand.

## Backup

```bash
cd /opt/endpoint-inventory
docker compose exec -T db pg_dump -U supabase_admin -h localhost -d postgres -Fc > backups/inventory-$(date +%F).dump
```

Restore into this install only (same Vault key): stop `kong functions auth rest tls`, then
`docker compose exec -T db pg_restore -U supabase_admin -h localhost -d postgres --clean --if-exists < <file>`,
then `docker compose up -d`.

## Move from K3S (done once, 2026-11-03)

1. Stop the K3S collector (delete its Vault secrets `collector_url` and `collector_secret`), dump the K3S
   database, and copy the K3S secrets (`supabase`, `functions-env`, `smtp`, `pgsodium-root-key`) into `.env` and
   `pgsodium_root.key` here; the same JWT secret and keys keep the sessions and the Vault valid.
2. Start `db`, restore the dump, start the rest, recreate the Vault secrets `collector_url` /
   `collector_secret` if the dump has none.
3. Cloudflare: proxied record `inventory`, Origin Rule → 18444, origin certificate in `certs/`; Hostinger firewall
   18444.
4. Remove the K3S deployment (Argo CD application and namespace `inventory`).
