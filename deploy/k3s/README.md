# Deploy on K3S (Argo CD, self-hosted Supabase per app)

Same flow as the other apps on the server: **push to `main` → GitHub Actions → GHCR → tag bump in `deploy/k3s/app` → Argo CD sync**.

1. `.github/workflows/deploy.yml` runs lint and tests, builds three images tagged with the commit and pushes them to GHCR:
   - `ghcr.io/<repo>-web`: the front end plus the nginx gateway (`web.Dockerfile`, `nginx.conf.template`; rate limits from `app/rate-limits.env`, docs/operations.md › Rate limits and abuse protection); `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` come from repository variables (public by design);
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

## Keep the Vault key

The database's Vault (Sophos credential or AI keys, Hub key, job secrets) is encrypted with `pgsodium_root.key`, which
the Postgres image creates at first use in `/etc/postgresql-custom`, **inside the container, outside the data volume**.
A new database container (an image upgrade, a recreated container, **any restart of the `db-0` pod**) creates a new key, and every Vault secret can no
longer be read ("invalid ciphertext"). The one-host install keeps the key in the `db-config` volume; the layouts
below need this once.

1. Check the state (it must show the same number twice; "invalid ciphertext" means the key was already replaced:
   enter the secrets again in Settings and run step 2 of "First install" again for the job secrets):

   ```bash
   kubectl -n inventory exec db-0 -- psql -U supabase_admin -h localhost -d postgres -tAc "select count(*), count(decrypted_secret) from vault.decrypted_secrets"
   ```

2. Keep the current key in a Secret (it is not printed):

   ```bash
   kubectl -n inventory exec db-0 -- cat /etc/postgresql-custom/pgsodium_root.key > /tmp/pgsodium_root.key
   kubectl -n inventory create secret generic pgsodium-root-key --from-file=pgsodium_root.key=/tmp/pgsodium_root.key
   shred -u /tmp/pgsodium_root.key 2>/dev/null || rm -f /tmp/pgsodium_root.key
   ```

3. Mount it in the `db` StatefulSet of `app/stack.yaml` (only after step 2: a missing Secret stops the pod), push,
   and let Argo CD roll `db-0`:

   ```yaml
   # container postgres › volumeMounts:
   - { name: pgsodium-key, mountPath: /etc/postgresql-custom/pgsodium_root.key, subPath: pgsodium_root.key, readOnly: true }
   # pod spec › volumes:
   - name: pgsodium-key
     secret: { secretName: pgsodium-root-key, defaultMode: 0444 }
   ```

4. Check again with the command of step 1.

## First install of a new environment

1. Create the namespace and the secrets above; set the repository variables `VITE_SUPABASE_URL` (`https://<host>`) and `VITE_SUPABASE_ANON_KEY`.
2. Apply `deploy/k3s/app/stack.yaml` once and wait for `db-0`; as `supabase_admin`, set the passwords of `authenticator`, `supabase_auth_admin` and `postgres` to `POSTGRES_PASSWORD`, and `app.settings.jwt_secret`.
3. Create the Argo CD Application pointing at `deploy/k3s/app` on `main`; its migrate Job applies every migration.
4. Turn the cron jobs on by creating the Vault secrets they read (client: `collector_url` = `http://kong:8000/functions/v1/collector`, `collector_secret` = `COLLECTOR_SECRET`; Hub: `jev_url` = `http://kong:8000/functions/v1/jev`, `cron_secret` = `CRON_SECRET`). Without them the jobs do nothing.
