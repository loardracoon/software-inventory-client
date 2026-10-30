# Endpoint Inventory: operations guide

Setup, deploy, configuration and day-to-day operations. For what the app does, the quick install and the first
steps, see the [README](../README.md).

Design and rules: `CLAUDE.md`, `docs/spec.md` and `docs/phases/`.

## Local setup

Requirements: Docker Desktop and Node 22+. Deno and the Supabase CLI are not needed globally: the CLI is a dev dependency, and `functions:check` runs Deno in Docker.

```bash
npm install
cp .env.example .env.local                                   # front end: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
cp supabase/functions/.env.example supabase/functions/.env   # Edge Function env (git-ignored)
npm run stack:up                                             # Supabase on 54321-54324 + the web container on 5173
```

1. Use the API URL and anon key that `npm run db:status` prints in `.env.local`.
2. Open http://localhost:5173 and sign in with a magic link. Mailpit (http://127.0.0.1:54324) receives the email.
3. The first user becomes admin, and later users start as viewer.
4. As admin, go to Settings:
   - save the Sophos Central API credential;
   - click **Test connection** and then **Sync now**;
   - add the Dictionary Hub and the alert channels.
5. Turn the collector on: `npm run collector:configure` (and `-- --off` to stop). It writes the collector URL and secret into Vault, and pg_cron starts calling it every 5 minutes.

After changing `supabase/config.toml`, `supabase/functions/.env` or adding an Edge Function, restart the stack with `npx supabase stop` then `npx supabase start`. Without `--no-backup` the data is kept. `docker restart` does not reload the env.

**Never run `npm run db:reset` on a database with real data.** For tests that need a clean database, use a second stack (see Tests).

### Mocks

| Command | Port | Stands in for | How to point the app at it |
| --- | --- | --- | --- |
| `npm run mock:sophos` | 54999 | Sophos Central and Live Endpoint Search | In a separate functions env file, set `SOPHOS_ID_URL`, `SOPHOS_GLOBAL_URL` and `SOPHOS_LES_URL` to `http://host.docker.internal:54999` (and `…/graphql` for LES). |
| `npm run mock:hub` | 54998 | Dictionary Hub client API | In Settings › Dictionary hub, save `http://host.docker.internal:54998` with the key `mock-hub-client-key-0123456789`. |
| `npm run mock:alerts` | 54997 | Alert webhook and the Resend API | Webhook `http://host.docker.internal:54997/webhook/x`, plus `RESEND_API_URL=http://host.docker.internal:54997/emails` in the functions env. |

## Deploy on one host (Docker Compose) — recommended

The simplest way to run the app on a server or a lab VM: one script installs everything in `deploy/compose` with the images CI publishes (no build, no GitHub login: the images are public).

| | One host (this section) | K3S (`deploy/k3s/README.md`) | Supabase Cloud (below) |
| --- | --- | --- | --- |
| Effort | one command | Kubernetes, Argo CD, secrets by hand | CLI steps, Vault SQL, a web host |
| Updates | `update.sh` or a timer | automatic (GitOps) | by hand |
| Good for | a team, a demo, a lab | a cluster that already runs Argo CD | a managed database |

Needs: a Linux host with Docker Engine and Docker Compose 2.24 or later, `openssl` and `curl`; 2 vCPU and 4 GB RAM; for HTTPS, a DNS name that points at the host and ports 80 and 443 open.

```bash
git clone https://github.com/loardracoon/software-inventory-client.git
cd software-inventory-client/deploy/compose
sudo ./install.sh --domain inventory.example.com --auto-update     # HTTPS (Let's Encrypt), updates every 15 min, daily backup
# or, for a lab or a laptop:  ./install.sh --http-port 8080 --host <name or IP>
# real email for the sign-in links:  --smtp-host smtp.example.com --smtp-port 465 --smtp-user ... --smtp-pass ... --smtp-from ...
```

What `install.sh` does (it is safe to run again; it keeps the secrets it made):

1. Checks Docker, Compose, `openssl` and `curl`.
2. Writes `.env` (chmod 600): new random database password, JWT secret, collector secret and Mailpit password; the anon and service keys signed with that secret; the address; the image tag CI deployed on `main`.
3. Pulls the images, starts Postgres, sets the role passwords and the JWT secret, applies every migration, starts the services and waits until they are healthy.
4. Turns on the scheduled jobs (the Vault secrets `collector_url` and `collector_secret`).
5. With `--auto-update`: installs the systemd timers `endpoint-inventory-update` (every 15 minutes) and `endpoint-inventory-backup` (daily, 03:15).
6. Checks the app through Caddy and prints the next steps: open the address and sign in with your email (**the first account becomes the admin**; without SMTP the link is in Mailpit at `/mail/`, user `mail`, password `MAIL_PASSWORD` in `.env`), then add the Sophos Central credential and the Dictionary Hub in Settings.

What runs: `db` (Postgres with pg_cron and Vault; the Vault key is kept in the `db-config` volume), `auth`, `rest`, `functions`, `kong` (the console and API gateway, the same image as K3S), `mailpit`, and `caddy`, the only published service (HTTPS with Let's Encrypt for a domain, plain HTTP for `--http-port`; it also gives the gateway the client address for the rate limits).

| File in `deploy/compose` | What it is |
| --- | --- |
| `docker-compose.yml`, `Caddyfile` | The services; Caddy in front |
| `.env` | Secrets and settings written by `install.sh` (never commit; `.gitignore` keeps it out) |
| `rate-limits.env` | Rate limits (Rate limits and abuse protection, below) |
| `install.sh` | First install, and repairs (run it again) |
| `update.sh` | `git pull`, then the image tag CI wrote into `deploy/k3s/app/stack.yaml`: pulls the images, applies new migrations, recreates what changed. `--tag <sha>` pins a build |
| `backup.sh` | `backups/inventory-<time>.dump` (as `supabase_admin`, so Auth, Vault and the jobs are included); keeps the newest 14 (`KEEP=n`) |
| `restore.sh <file>` | Stops the app services, restores the dump, starts them again (asks first; `--yes` to skip) |
| `uninstall.sh` | Removes the containers and the timers, **keeps** the data, `.env` and `backups/` (`./install.sh` brings it back as it was). `--purge` also deletes the database, the volumes, `.env` and the images (type `delete` to confirm); `--purge-backups` deletes `backups/` too |
| `docker-compose.override.yml` | Written by `install.sh --domain`: publishes port 443 (plain HTTP publishes only `HTTP_PORT`) |

Day to day: `docker compose ps`, `docker compose logs -f kong functions`, change a setting in `.env` or `rate-limits.env` then `docker compose up -d`. Copy `backups/` (with `.env`) off the host: a dump holds all the data, and its Vault secrets open only with that install's key, which `backup.sh` also copies to `backups/pgsodium_root.key`. To restore into a new host: install, stop `db`, put the key in the `db-config` volume (`/etc/postgresql-custom/pgsodium_root.key`, owner `postgres`), start `db`, then `./restore.sh`. Plain HTTP (`--http-port`) sends sign-in links and sessions without encryption: use it only on a trusted network.

## Deploying to a Supabase project

```bash
npx supabase link --project-ref <ref>
npx supabase db push                                  # all migrations
npx supabase functions deploy                         # every function in supabase/functions
npx supabase secrets set --env-file supabase/functions/.env
```

`supabase/config.toml` deploys `sync-computers`, `probe-capabilities`, `collector`, `hub-sync` and `alerts` with `verify_jwt = false`, because each of them checks the admin JWT or `x-collector-secret` itself. Keep it that way.

Build the front end with the project URL and anon key and serve `dist/`. The Dockerfile's `prod` target is nginx.

Before exposing the app:

- In Auth settings, turn off open sign-ups, or move to SSO (below).
- Set `site_url` and the redirect URLs to the real host.

### Cron (pg_cron → pg_net → Edge Functions)

| Job | Schedule | What it does |
| --- | --- | --- |
| `collector-tick` | every 5 min | Runs the collector: computer sync, weekly cycles, Live Discover dispatch and poll, ingest, dictionary sync, retries. |
| `alerts-tick` | every 5 min | Runs `alerts`: detects low coverage, query errors and a silent collector, and delivers them. This job is kept apart from the collector so a stopped collector is still reported. |
| `raw-results-retention` | 03:30 UTC daily | `purge_raw_results(90)`: deletes ingested raw results older than 90 days. Everything else is kept. |

The migrations create all three jobs. `collector-tick` and `alerts-tick` do nothing until Vault holds `collector_url` and `collector_secret`. On a remote project, run this in the SQL editor:

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1/collector', 'collector_url');
select vault.create_secret('<COLLECTOR_SECRET>', 'collector_secret');   -- same value as the Edge Function secret
```

`alerts-tick` calls the same URL with `/alerts` instead of `/collector`.

### Secrets: where each one lives

| Secret | Where | Set by |
| --- | --- | --- |
| Sophos Central client secret | Vault (`sophos_client_secret`) | Settings › Sophos Central (admins). Env `SOPHOS_CLIENT_ID` / `SOPHOS_CLIENT_SECRET` is only a fallback. |
| Dictionary Hub client key | Vault (`hub_client_key`) | Settings › Dictionary hub. Env `HUB_URL` / `HUB_CLIENT_KEY` is the fallback. |
| Alert webhook URL, Resend API key | Vault (`alert_webhook_url`, `alert_resend_key`) | Settings › Alerts |
| `COLLECTOR_SECRET` | Edge Function secret **and** Vault (`collector_secret`) | `supabase secrets set` + SQL above |
| `SOPHOS_LES_URL` | Edge Function secret | `https://api.taegis.sophos.com/graphql`; unset = Live Discover REST |

The browser only writes secrets (through admin-only RPCs) and sees hints such as `••••7777`. The audit log records changes without the values.

## Operations

### Rotate the Sophos Central credential

1. In Sophos Central › API credentials, create a new credential with the same role.
2. In Settings › Sophos Central, click **Replace credential**, paste the new client ID and secret, then click **Test connection**.
3. Delete the old credential in Sophos Central.

The secret is updated in place in Vault, and the next collector tick uses it.

### Rotate the Dictionary Hub key

1. The Hub admin clicks **Rotate** on the client.
2. Paste the new key in Settings › Dictionary hub › **Replace connection**.

Keeping the same URL keeps the sync position (`last_seq`). A different URL starts from zero.

### Add a query version

Queries are rows in `query_catalog`, unique on (platform, name, version), and change only by migration.

1. Write a migration that inserts the new version with a higher `version` (see `20261027030100_programs_query_v2.sql`).
2. If normalization changes, branch on the query version in `supabase/functions/_shared/normalize.ts`. Keep the old version's output identical, and back that with a test that pins a stored `row_hash`.
3. Cycles opened after the migration use the new version. The first collection with it is a **baseline**: the computer's rows for that query are replaced without change events, so nothing shows as added or removed.
4. Settings › Queries shows only the version in use. If the new SQL needs tables that were not probed, run **Probe again** there.

### Alerts

Configure them in Settings › Alerts:

- **Webhook:** any JSON endpoint. The message is in `text`, which works for Teams and Slack incoming webhooks.
- **Email:** sent through Resend. Set the sender address (on a domain verified in Resend), the recipients and the API key.
- **Thresholds:** coverage (default 90 %) and collector silence (default 30 min).
- **Send test alert** checks the channels.

Each condition is alerted once. Failed deliveries are retried for up to 5 attempts, and the last error shows in the card.

### API budget

The Scans page shows, per tenant: runs this minute (limit 10), runs today (limit 1,000 on Live Endpoint Search), the normal share left and the reserve left, and active runs (limit 4). Weekly tasks stop at 80 % of the day; the remaining 20 % is kept for retries and Scan now.

### Rate limits and abuse protection

Every variable is explained in [rate-limits.md](rate-limits.md). The text below is a short version.

All limits are in one file per deployment: **`deploy/k3s/app/rate-limits.env`** on K3S, **`deploy/compose/rate-limits.env`** on one host (Docker Compose loads it into the same three services; after a change, `docker compose up -d`). Kustomize turns it into the ConfigMap `rate-limits` (`deploy/k3s/app/kustomization.yaml`), which the gateway, Auth and the Edge Functions load; its name carries a hash of the content, so a change pushed to `main` rolls those pods through Argo CD. Values for a team of up to ~50 users behind one office address:

| Setting | Recommended | What it limits |
| --- | --- | --- |
| `RL_AUTH_STRICT_RATE` / `_BURST` | `10r/m` / `10` | Gateway, per address: `/auth/v1/otp`, `magiclink`, `signup`, `recover`, `resend`, `verify` (sign-in links and code checks) |
| `RL_AUTH_RATE` / `_BURST` | `120r/m` / `60` | Gateway, per address: other Auth calls (session refresh, user) and `/mail/` |
| `RL_REST_RATE` / `_BURST` | `30r/s` / `120` | Gateway, per address: the database API (a screen sends 10 to 30 requests at once) |
| `RL_FUNCTIONS_RATE` / `_BURST` | `10r/s` / `60` | Gateway, per address: Edge Functions (Sync now, Scan now, exports, policy evaluation) |
| `RL_CONN_PER_IP` | `60` | Gateway: open connections per address |
| `RL_BODY_AUTH` / `RL_BODY_REST` / `RL_BODY_FUNCTIONS` | `64k` / `2m` / `10m` | Gateway: largest request body (HTTP 413 above) |
| `GOTRUE_RATE_LIMIT_HEADER` | `X-Real-IP` | Auth: the header with the client address. **Without it GoTrue applies none of its per-address limits** (checked in the GoTrue source); the gateway sets it |
| `GOTRUE_RATE_LIMIT_OTP` | `10` | Auth: sign-in and sign-up requests per address per 5 minutes |
| `GOTRUE_RATE_LIMIT_VERIFY` | `15` | Auth: magic link and code checks per address per 5 minutes |
| `GOTRUE_RATE_LIMIT_TOKEN_REFRESH` | `60` | Auth: session refreshes per address per 5 minutes |
| `GOTRUE_RATE_LIMIT_EMAIL_SENT` | `60` | Auth: emails per hour for the whole app (sign-in links, invitations) |
| `RL_INVITES_PER_HOUR` | `20` | Edge Function `manage-users`: invitations and sign-in links per admin per hour (counted in the audit log) |

How it works:

- **Gateway** (nginx in the web image, `deploy/k3s/nginx.conf.template`): limits per client address with `limit_req` (HTTP 429), open connections, body sizes and timeouts against slow clients. The image has the recommended values as defaults; the ConfigMap overrides them. The client address comes from `X-Forwarded-For`, trusted only from private networks (the proxy in front), so a client cannot choose its own address. Calls between services (Edge Functions to PostgREST and Auth, database jobs to Edge Functions) carry no `X-Forwarded-For` and are not limited.
- **Auth** (GoTrue): per-address limits on sign-in, code checks and session refresh, keyed by the `X-Real-IP` header the gateway sets, and one email limit for the whole app.
- **Edge Functions**: the per-admin invitation limit.

Raise the gateway rates when many users share one public address (one office behind NAT): every limit is per address. Lower them when the app is open to the internet and has few users.

Check the client address after a change: the gateway access log (`kubectl -n inventory logs deploy/gateway`) must show the real public addresses, not one internal address for everyone. On K3S the Traefik service must keep the client address (`externalTrafficPolicy: Local` on `kube-system/traefik`, and no address translation on the firewall in front, or a proxy that sends `X-Forwarded-For`). If every request shows the same address, all users share one limit: fix the address first, or raise the values. A blocked request gets HTTP 429 and a line `limiting requests` in that log.

Limits that were already in place: Sophos API budget per tenant (10 runs per minute, 1,000 per day, Scans › API budget), Hub sync back-off (5 minutes up to 6 hours), retries of 429 and 5xx with back-off in `_shared/http.ts`.

Local development (`supabase start`) uses the Supabase CLI gateway and `supabase/config.toml` › `[auth.rate_limit]` instead.

### SSO with Entra ID (not enabled yet)

SAML SSO needs a Supabase project on the Pro plan and cannot run on the local stack. When a test Entra tenant is available:

1. **Entra:** create an Enterprise application (non-gallery) with SAML.
   - Identifier (Entity ID): `https://<ref>.supabase.co/auth/v1/sso/saml/metadata`
   - Reply URL (ACS): `https://<ref>.supabase.co/auth/v1/sso/saml/acs`
   - Add a group claim (security groups, sent as group object IDs) and keep the email claim.
2. **Supabase:**
   ```bash
   npx supabase sso add --type saml --project-ref <ref> \
     --metadata-url 'https://login.microsoftonline.com/<tenant-id>/federationmetadata/2007-06/federationmetadata.xml?appid=<app-id>' \
     --domains <your-domain> --attribute-mapping-file sso-attributes.json
   ```
   `sso-attributes.json` maps `email` to `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` and `groups` to `http://schemas.microsoft.com/ws/2008/06/identity/claims/groups` (as an array).
3. **App (to build when SSO is turned on):**
   - a "Sign in with Microsoft" button calling `supabase.auth.signInWithSSO({ domain })`;
   - a table `sso_group_roles (group_id, role, tenant_id null = global)` edited in Settings;
   - a trigger on `auth.users` that sets `profiles.role` and `tenant_members` from the user's groups at each sign-in.

   First check with a test login where the mapped attributes land (the identity data or `raw_user_meta_data.custom_claims`) and write the trigger against that.
4. Then turn off email sign-ups so only SSO users get in.

## Tests

| Command | What |
| --- | --- |
| `npm test` | Vitest: front end (jsdom) and the runtime-neutral Edge Function modules (`supabase/functions/_shared/*.test.ts`). |
| `npm run test:db` | pgTAP files in `supabase/tests/database/`. Each one truncates the app tables inside its own transaction and rolls back, so it is safe on a database with data. |
| `npm run functions:check` | `deno check` of every Edge Function, in Docker. |
| `npm run lint` / `npm run build` | ESLint; type check and production build. |
| `npm run test:e2e` | Playwright: every route renders for a signed-in admin with no console errors (`e2e/smoke.spec.ts`), the application policy flow (`e2e/policy.spec.ts`) and the known vulnerabilities screens (`e2e/vulns.spec.ts`, read only, after a sync from the mock Hub). |

`test:e2e` needs a stack with data whose `site_url` is the app under test. The default is an isolated second stack:

1. Copy `supabase/` to a scratch folder.
2. In its `config.toml`, change `project_id` and every port (e.g. 553xx) and set `site_url = "http://localhost:5174"`.
3. Start it with `npx supabase start --workdir <copy>`.
4. Fill it with the mocks.
5. Serve the app for it: `VITE_SUPABASE_URL=http://127.0.0.1:55321 VITE_SUPABASE_ANON_KEY=<its anon key> npx vite --port 5174`.

`e2e/policy.spec.ts` expects an empty stack loaded with `e2e/fixtures/policy-seed.sql` and no policy; it writes, reorders and publishes rules there. `e2e/vulns.spec.ts` expects the same stack after Settings › Dictionary Hub › Sync now from the mock Hub (`npm run mock:hub`), whose mock CVE affects Adobe Acrobat 23.008.

Override the defaults with `E2E_BASE_URL`, `E2E_SUPABASE_URL`, `E2E_MAILPIT_URL` and `E2E_EMAIL`. Before the first run, install the browser with `npx playwright install chromium`.
