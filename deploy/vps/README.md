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

- From this folder: `docker-compose.yml`, `tls.conf`, `rate-limits.env`, `update.sh`, the systemd units, `backup.sh`, `offsite.sh`, `backup.env.example`;
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

## Backups

`backup.sh` runs daily at 03:45 UTC (`endpoint-inventory-backup.timer`, 15 minutes after the Hub): `pg_dump`, a full
read check with `pg_restore`, mode 600 in `backups/`, the newest `KEEP` (14) kept, and a one-time copy of
`pgsodium_root.key` into `backups/`. A bad night keeps the last good dump. With `OFFSITE_ENABLED=1`, `offsite.sh`
then encrypts the dump with `age` and sends the `.age` copy to every target set in `backup.env`. The plain dump
never leaves the host. A failed target is logged (`offsite s3: failed`) and the unit exits non-zero, but the local
dump stays.

1. `apt install age` on the server, and rclone. The apt rclone of Ubuntu 22.04 is old (no Cloudflare provider):
   install the current release from rclone.org, or use `provider = Other` in the S3 remote.
2. Make the key pair **off the server**: `age-keygen -o key.txt`. Keep `key.txt` offline (password manager, safe).
   Only the public key (`age1...`) goes to the server.
3. `cp backup.env.example /opt/endpoint-inventory/backup.env`, `chmod 600`, and fill it in. Leave out a target to turn
   it off.
   - S3 (R2, B2, any S3): `rclone config` with `RCLONE_CONFIG=/opt/endpoint-inventory/rclone.conf`, then
     `OFFSITE_S3=<remote>:<bucket>/inventory`. Use a key that can only write to this bucket. If that key cannot
     create buckets, add `no_check_bucket = true` to the remote.
   - FTP or SFTP: the same, with an `ftp` or `sftp` remote, `OFFSITE_FTP=<remote>:<dir>`.
   - Email: `OFFSITE_EMAIL_TO`, `OFFSITE_EMAIL_FROM`, `SMTP_URL` (for example `smtps://mail.<domain>:465`),
     `SMTP_USER`, `SMTP_PASS`. The encrypted file is sent only when it is at most `OFFSITE_EMAIL_MAX_MB` (20) MB;
     bigger files log `offsite email: skipped (size)`. Base64 adds a third, so check the mail server limit.
     The password goes to `curl` in a temporary file, not on the command line.
   - `OFFSITE_SEND_KEY=1` also sends the Vault key, encrypted. Default 0: copy `pgsodium_root.key` off the host by hand.
4. `chmod 600 /opt/endpoint-inventory/rclone.conf`, `chmod 755 backup.sh offsite.sh update.sh`, copy the two backup units to `/etc/systemd/system/`,
   `systemctl daemon-reload && systemctl enable --now endpoint-inventory-backup.timer`.
5. Test once: `systemctl start endpoint-inventory-backup.service` (also for manual runs: the scripts read no file,
   only the unit loads `backup.env`), then
   `journalctl -u endpoint-inventory-backup.service` (look for `offsite <target>: ok`).
6. Set a lifecycle rule on the bucket (delete objects after N days, for example 30) and clear old files on the FTP
   target, so off-host copies expire too.

Restore into this install only (same Vault key; keep a copy of `pgsodium_root.key` that matches the dump): fetch the
`.age` file, `age -d -i key.txt inventory-<stamp>.dump.age > inventory.dump`, stop `kong functions auth rest tls`,
then `docker compose exec -T db pg_restore -U supabase_admin -h localhost -d postgres --clean --if-exists < inventory.dump`,
then `docker compose up -d`. With `OFFSITE_SEND_KEY=1`, the Vault key copy is decrypted the same way:
`age -d -i key.txt pgsodium_root.key.age > pgsodium_root.key`.

## Move from K3S (done once, 2026-11-03)

1. Stop the K3S collector (delete its Vault secrets `collector_url` and `collector_secret`), dump the K3S
   database, and copy the K3S secrets (`supabase`, `functions-env`, `smtp`, `pgsodium-root-key`) into `.env` and
   `pgsodium_root.key` here; the same JWT secret and keys keep the sessions and the Vault valid.
2. Start `db`, restore the dump, start the rest, recreate the Vault secrets `collector_url` /
   `collector_secret` if the dump has none.
3. Cloudflare: proxied record `inventory`, Origin Rule → 18444, origin certificate in `certs/`; Hostinger firewall
   18444.
4. Remove the K3S deployment (Argo CD application and namespace `inventory`).
