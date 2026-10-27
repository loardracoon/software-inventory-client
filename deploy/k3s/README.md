# Deploy on K3S (Argo CD, self-hosted Supabase per app)

Same flow as the other apps on the server: **push to `main` → GitHub Actions → GHCR → tag bump in `deploy/k3s/app` → Argo CD sync**.

1. `.github/workflows/deploy.yml` runs lint and tests, builds three images tagged with the commit and pushes them to GHCR:
   - `ghcr.io/<repo>-web`: the front end plus the nginx gateway (`web.Dockerfile`, `nginx.conf`); `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` come from repository variables (public by design);
   - `ghcr.io/<repo>-functions`: edge-runtime with `supabase/functions` and the `functions/main` router (`functions.Dockerfile`);
   - `ghcr.io/<repo>-migrate`: `supabase/migrations` and `migrate.sh` (`migrate.Dockerfile`).
2. It writes the new tag into `deploy/k3s/app/*.yaml` and commits it with `[skip ci]` (the folder is in `paths-ignore`, so no loop).
3. The Argo CD Application (namespace `argocd`, auto-sync with prune and self-heal) applies `deploy/k3s/app`. The `migrate` Job runs first (PreSync) and applies only the migrations not yet in `supabase_migrations.schema_migrations`; then the new functions and front end roll out.

Never edit the image tags by hand. To redeploy without a code change, run the workflow manually (`workflow_dispatch`).

## What runs in the namespace

| Pod | Image | Role |
| --- | --- | --- |
| `db-0` | `supabase/postgres:17.11.0.006` | Postgres with pg_cron, pg_net, Vault; 5 GiB `local-path` volume |
| `auth` | `supabase/gotrue:v2.197.0` | Magic-link sign-in; sign-ups off |
| `rest` | `supabase/postgrest:v16.5` | REST API |
| `functions` | `<repo>-functions` | Edge Functions; `main` verifies the JWT except for `NO_VERIFY_JWT` (the `verify_jwt = false` functions) |
| `mailpit` | `supabase/mailpit` | Receives the magic-link emails (no SMTP yet); UI at `/mail/` behind basic auth |
| `gateway` (Service `kong:8000`) | `<repo>-web` | Front end plus `/auth/v1`, `/rest/v1`, `/functions/v1`, `/mail/` on one host |

Traefik serves `https://<host>` with the `tls` secret (self-signed, internal network) and redirects HTTP to HTTPS. Database jobs and client→Hub calls use in-cluster names (`http://kong:8000`, `http://kong.dictionary-hub.svc.cluster.local:8000`).

## Secrets (never in git; created once with `kubectl create secret ... --from-env-file=/dev/stdin`)

- `supabase`: `POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY` (HS256 JWTs signed with that secret), `AUTH_DB_URL`, `REST_DB_URL`, `FUNCTIONS_DB_URL` (also used by the migrate Job).
- `functions-env`: client `COLLECTOR_SECRET`, `SOPHOS_LES_URL`; Hub `CRON_SECRET`, `HUB_CONSOLE_URL`, `JEV_PROVIDER`, `RESEARCH_PROVIDER`.
- `mail-htpasswd` (nginx basic auth) and `mail-login` (the same user and password in clear, to read back).
- `tls`: certificate and key for the host.

App secrets (Sophos credential, Hub client key, provider keys) live in each database's Vault, entered in Settings.

## First install of a new environment

1. Create the namespace and the secrets above; set the repository variables `VITE_SUPABASE_URL` (`https://<host>`) and `VITE_SUPABASE_ANON_KEY`.
2. Apply `deploy/k3s/app/stack.yaml` once and wait for `db-0`; as `supabase_admin`, set the passwords of `authenticator`, `supabase_auth_admin` and `postgres` to `POSTGRES_PASSWORD`, and `app.settings.jwt_secret`.
3. Create the Argo CD Application pointing at `deploy/k3s/app` on `main`; its migrate Job applies every migration.
4. Turn the cron jobs on by creating the Vault secrets they read (client: `collector_url` = `http://kong:8000/functions/v1/collector`, `collector_secret` = `COLLECTOR_SECRET`; Hub: `jev_url` = `http://kong:8000/functions/v1/jev`, `cron_secret` = `CRON_SECRET`). Without them the jobs do nothing.
