# Endpoint Inventory (client)

Weekly osquery inventory of every computer in a Sophos Central account (hardware, programs, browser and IDE extensions, packages), collected through Sophos Live Endpoint Search, stored with full version history in the user's own Supabase project, and classified with the shared Dictionary Hub. Each person who clones this app connects their own Sophos Central credential; nothing about their computers ever leaves their Supabase project.

## Read before coding

1. `docs/phases/README.md`: build order and status. Work on one phase at a time.
2. The phase file you are on, e.g. `docs/phases/client-04-scan-cycle.md`. It is the task.
3. `docs/spec.md`: the design document (Portuguese prose, English prompts and SQL). Read the section that matches the phase. Its "Read this first" box lists the decisions that superseded parts of it.
4. `docs/taxonomy.md` / `docs/taxonomy.csv`: the two-level category taxonomy (29 level 1, 71 level 2).
5. `design/README.md` and `design/mock/*.dc.html`: the clickable mock (Sophos Design System 2026) with sample data.
6. `docs/phases/hub-H2-client-api.md`: the Hub API this app calls (Phase 7).

## Stack

- Front end: Vite, React, TypeScript, Tailwind, shadcn/ui, TanStack Table (server-side paging), Recharts.
- Back end: own Supabase project, Pro plan, region sa-east-1 (São Paulo). Postgres with pg_cron, pg_net, pg_trgm and Vault. Edge Functions in Deno/TypeScript.
- Sophos: id.sophos.com OAuth2, whoami, Partner/Organization tenant APIs, Endpoint API, Live Endpoint Search GraphQL (default) and Live Discover REST (fallback) behind one `SophosQueryProvider` interface.
- Layout once Phase 0 runs: `src/` app, `src/styles/tokens.css`, `supabase/migrations/`, `supabase/functions/<name>/`, `supabase/functions/_shared/`, `fixtures/`, `docs/`, `design/`.

## Commands

Keep these current. The Supabase CLI is a devDependency: run it as `npx supabase ...` (or the npm scripts below).

Local stack in containers (Docker Desktop must be running):

- `npm run stack:up` / `npm run stack:down`: Supabase local stack + the `web` dev container, together.
- `npm run db:start` / `db:stop` / `db:status`: Supabase local stack (Postgres 17 with pg_cron, pg_net, pg_trgm, Vault; Auth, PostgREST, Edge Runtime, Studio, Mailpit). Containers are named `supabase_*_endpoint-inventory`.
- `npm run web:up` / `web:down` / `web:logs`: Vite dev server in a container (`docker-compose.yml`, target `dev`) with the source bind-mounted and polling for changes. `web:up` rebuilds and renews the `node_modules` volume, so run it after changing dependencies.
- `docker compose --env-file .env.local --profile prod up -d --build web-prod`: production build served by nginx on port 8080.
- Without the web container: `npm run dev` on the host (same port 5173; stop the container first).

Local URLs: app http://localhost:5173, API http://127.0.0.1:54321, Studio http://127.0.0.1:54323, Mailpit (magic-link emails) http://127.0.0.1:54324, Postgres `postgresql://postgres:postgres@127.0.0.1:54322/postgres`. From inside the database container (pg_net calls made by pg_cron), the API is `http://kong:8000`, so the local collector URL is `http://kong:8000/functions/v1/collector`.

Front end env: `.env.local` (git-ignored) with `VITE_SUPABASE_URL=http://127.0.0.1:54321` and `VITE_SUPABASE_ANON_KEY` = `ANON_KEY` from `npx supabase status -o env`. `.env.local` is read only by Vite: never put Edge Function settings or secrets there. Edge Function env: copy `supabase/functions/.env.example` to `supabase/functions/.env` (git-ignored); `npm run db:start` loads it when the stack starts, so restart the stack (`npm run db:stop && npm run db:start`) after changing it.

Signing in locally: enter any email on /login and open the link from Mailpit. The first user of a fresh database becomes admin, later users start as viewer (`update public.profiles set role = 'admin' where email = '…'` in Studio to promote). `npm run db:reset` wipes users too.

Front-end conventions: DS tokens are Tailwind colours (`bg-surface-subtle`, `text-text-muted`, `bg-status-high`, `border-border-subtle`…; see `@theme` in `src/index.css`); the DS `--accent` is `ds-accent` because shadcn's `accent` is the hover surface. Shared components live in `src/components/shared/`, shadcn in `src/components/ui/` (restyled, imports `@/lib/utils`). TanStack Table is v9 (`useTable`, `tableFeatures`; guides in `node_modules/@tanstack/react-table/skills/`) and React Router is v8.

- `npm install`, `npm run dev`, `npm run build`, `npm test` (Vitest), `npm run lint`
- `npm run db:reset` (re-run migrations and `supabase/seed.sql` locally)
- `npm run test:db` (pgTAP tests in `supabase/tests/database/`: RLS, masking, history rules, classification). Each file starts with the same preamble that empties the app tables inside its transaction (rolled back), so tests pass with real local data; copy it into new test files.
- `npx supabase link --project-ref <ref>`, `npx supabase db push` (apply migrations to the remote project)
- `npm run functions:serve` (all functions, with `supabase/functions/.env`), `npx supabase functions deploy <name>` (the collector and `sync-computers` deploy with `--no-verify-jwt`; they check the admin JWT or `x-collector-secret` themselves, see `[functions.*]` in `supabase/config.toml`)
- `npm run db:start` also serves the Edge Functions, but only those present when the stack started: after adding a function, restart the stack or use `functions:serve`.
- `npm run functions:check` (`deno check` of every function in Docker). Shared code in `supabase/functions/_shared/` stays runtime-neutral (no `npm:`/`Deno` imports) except `edge.ts`, so Vitest covers it (`*.test.ts` next to the module).
- `SOPHOS_LES_URL` (Edge Function env): the Live Endpoint Search GraphQL URL, `https://api.taegis.sophos.com/graphql` (not in the public docs; validated Oct 26, 2026 with a Sophos Central token and `X-Tenant-ID`). Unset = runs fall back to the Live Discover REST API and the probe says so.
- `npm run mock:sophos` (local Sophos Central mock on port 54999, including Live Endpoint Search at `/graphql`; point `SOPHOS_ID_URL` / `SOPHOS_GLOBAL_URL` at `http://host.docker.internal:54999` in a separate env file for `functions serve --env-file`; never in `supabase/functions/.env` for real use)
- `npm run mock:hub` (local Dictionary Hub mock on port 54998; in Settings › Dictionary hub save `http://host.docker.internal:54998` with the key `mock-hub-client-key-0123456789`; test routes `/__publish`, `/__deprecate`, `/__decide`, `/__down`, `/__state`)
- `npm run mock:alerts` (local webhook and Resend stand-in on port 54997; `RESEND_API_URL=http://host.docker.internal:54997/emails` in a test functions env)
- `npm run test:e2e` (Playwright smoke tests against a stack with data and the app served for it; defaults: isolated stack 55321 + app on 5174; see README › Tests)
- `npm run collector:configure` turns the local pg_cron tick on (writes `collector_url` = `http://kong:8000/functions/v1/collector` and `collector_secret` = `COLLECTOR_SECRET` from `supabase/functions/.env` into Vault); `-- --off` turns it off. While on, the lab tenant gets real Live Discover runs every 5 minutes. `npm run collector:tick` runs one tick now. Remote projects: the SQL in the header of `supabase/migrations/*_collector_cron.sql`.
- End-to-end tests that need a clean database (e.g. against the mock) run on a second, isolated stack: copy `supabase/` to a scratch folder, change `project_id` and every port in its `config.toml` (e.g. 553xx), `npx supabase start --workdir <copy>`, then `npx supabase stop --no-backup --workdir <copy>`. Never reset the main local database: it holds the real lab credential and inventory.
- `npx supabase secrets set --env-file supabase/functions/.env` (never commit that file)
- `npm run db:types` (local) or `npx supabase gen types typescript --linked > src/integrations/supabase/types.ts` after each migration

## Database conventions (Phase 1)

- Roles (`app_role`): admin (changes everything), operator (reads everything incl. usernames, exports, requests reclassification, runs Scan now; no Settings changes), viewer (reads with usernames masked, searches).
- Who may sign in: `access_rules` (an exact email with any role, or an email domain as viewer/operator), managed in Settings › Users and access. The trigger `before_auth_user_created` refuses accounts that Auth creates without a rule (except the first account, which becomes admin); `manage-users` writes the email rule and sends the one-click invitation.
- Access: global admins (`profiles.role = 'admin'`) see every tenant; everyone else sees the tenants in `tenant_members` with the role set there, or every tenant with their profile role when they have no membership rows. `public.my_tenant_roles()` returns `(tenant_id, role)` for the caller. Policy patterns: read `tenant_id in (select r.tenant_id from public.my_tenant_roles() r)`; usernames `... where r.role in ('admin','operator')`; admin writes `... where r.role = 'admin'`.
- Every per-computer table has `tenant_id` and a composite FK `(computer_id, tenant_id) → computers(id, tenant_id)`.
- The app reads computers and installations through `v_computers`, `v_installations` and `current_installations` (they mask usernames, scope and the user folder in paths for viewers), and titles through `v_title_summary`. Direct `computers`/`installations` reads are for admins and operators only.
- Categories: `categories_cache` (key = slug), `dictionary_cache`, `local_overrides`; `title_classification` resolves override > dictionary > unclassified. Never recreate local category or rule tables.
- Collection (Phase 4): one scan task per (cycle, computer, query); the collector Edge Function only does I/O and drives the SQL functions in `*_scan_cycle_engine.sql` (open/close cycles, SKIP LOCKED claims, results, retries) and the pure modules `_shared/schedule.ts`, `budget.ts`, `collector-plan.ts`. A Sophos run counts as active until `started_at + max_duration_seconds + 2 min` regardless of its reported status, and cancel failures are warnings (lab findings).
- Inventory (Phase 5): raw results → `_shared/normalize.ts` (pure; one normalizer per domain) → `ingest_snapshot` → `apply_snapshot` (SCD type 2, diff scope = computer + query_name). The first collection of each computer and query and every new query version is a baseline without change events. Change normalization only together with a new query version or a test that proves existing row hashes stay the same, or every installation will show as updated.
- Screens (Phase 6): every screen reads through `src/features/inventory/api.ts` (views `v_*` and RPCs from `*_screen_queries.sql`); tests mock that module with `src/test/inventory-mock.ts`. New lists go through `ServerDataTable` with server-side paging, sorting and filters, and tenant selection from `useTenant()` (null = all visible tenants).
- Dictionary (Phase 7): only Edge Functions talk to the Hub (`_shared/hub.ts` copies just kind, source, match_key, name, vendor, description and the OS families where the title is installed (`platforms`: windows, macos, linux) into titles-submit; never hostnames, users, tenants, versions or counts; a title goes again when it appears on a new OS; an older Hub that refuses `platforms` gets the titles without it). The client key lives in Vault (`set_hub_connection`), the sync state in `hub_connection`; `hub-sync` and the collector step `hub_sync` pull `dictionary-changes` through `apply_dictionary_changes` (categories matched by slug, entries by hub category id), share unknown titles only while the switch is on and follow open requests; failures back off 5 min → 6 h. CSV exports are built and audited by `export_csv` (admins and analysts, `can_contribute()`), never in the browser. Saved searches store the /software URL parameters, so every Software filter must live in the URL.
- Hardening (Phase 8): alerts are detected in SQL (`detect_alerts`, idempotent through `alerts.dedupe_key`) and delivered by the `alerts` Edge Function from its own cron job, never from the collector, so a stopped collector is still reported. Webhook URL and Resend key live in Vault. `normalize()` takes the query version: program keys use `productName()` from v2 on, and v1 output must stay byte-identical (a test pins a stored `row_hash`). `query_catalog_status` shows only the latest version of each query.
- Policy classes (Phase 9): every installed (title, version) of a tenant gets one class (core system, sanctioned, tolerated, unsanctioned; CIS v8.1 Control 2). Classes are local: never send classes, rules or anything about them to the Hub. Rules run top down, disabled rules are skipped, the first match wins, else the policy's default class. The evaluator lives in `supabase/functions/_shared/policy.ts` (pure; the browser imports it as `@policy`) and is the only place that decides a class; SQL stores policies and results. Version conditions apply to each installation's version, not to the title's newest version. A title shows its most restrictive class (`title_policy`). Admins change only the draft, through the `policy_*` RPCs (audited); `policy_publish` validates, then the browser runs `policy-evaluate` and the collector step `policy` covers new pairs and dictionary changes. Class colours are the `--class-*` tokens; always show the class name next to its colour.
- Products (phase 10a, with Hub H6): titles that differ only by version, architecture or vendor spelling are one product. `software_titles.product_base` is generated with the Hub's SQL functions `product_name()` and `vendor_key()` (same test vectors in both repos: change both together); `dictionary_cache.product_key` is the Hub's key; `title_products` gives each title its product (Hub key when known, else kind | product_base). A title without its own dictionary entry takes the classification of its product (`title_classification`). Software (`search_titles`) shows one row per product with `spellings`; the title page uses `title_group_ids` for versions, computers and changes. Titles and history are never rewritten.
- Vulnerabilities (phase 10b, with Hub H7): the Hub sends CVEs with affected version ranges per product key (`vulnerability-changes`, pulled by hub-sync into `vuln_cache`); only this app compares its installed versions (`_shared/vuln-match.ts`, the policy's `compareVersions`), so never send versions, hosts or counts to the Hub. Matches live in `title_version_vulns` (full run per tenant with a run id, `vuln-run.ts`, collector step `vulns` before `policy`); "uncertain" matches (no usable version, or no bound in the CVE) show on screens but never count in the policy fields `cvss` / `kev` / `epss`, Changes or the KEV alert.
- `public.version_key(text)` orders dot-separated versions. Revoke `anon` on every new table or view, enable RLS with explicit policies, and add a pgTAP test for each new policy.

## Rules that must not break
- Two production layouts run the same images: `deploy/k3s/app/stack.yaml` and the one-host `deploy/compose/docker-compose.yml` (README › Deploy on one host). A change to a service's image, environment or secrets goes into both; `install.sh` must stay safe to run again (never replace a secret in `.env`). CI checks the Compose file and the scripts.

- Rate limits live in one file per deployment: deploy/k3s/app/rate-limits.env and deploy/compose/rate-limits.env (README › Rate limits and abuse protection). The gateway is a template (`deploy/k3s/nginx.conf.template`, defaults in `web.Dockerfile` as `RL_*`): add a new limit there and in every rate-limits.env. GoTrue's per-address limits need `GOTRUE_RATE_LIMIT_HEADER=X-Real-IP` (the gateway sets it); calls between services have no X-Forwarded-For and are not limited, so never add one to internal calls.
- Code, comments, UI copy and migration names in English.
- Only Edge Functions call Sophos APIs. Sophos credentials, tokens and the service role key never reach the browser or the repo.
- The browser never sends osquery SQL. Queries live in `query_catalog`, versioned (`inv.extensions.v1`), changed only by migration.
- Every schema change is a SQL migration. Every table has RLS enabled with explicit policies (admin, operator, viewer; viewers see usernames masked; partner users see only their tenants).
- Never delete inventory history. Close rows with `valid_to` (SCD type 2). `apply_snapshot` is transactional and idempotent.
- An offline or silent computer is never marked as removed. Only a successful snapshot can remove an installation. Missed tasks keep the last inventory and its date.
- A new query version starts a new baseline without change events.
- A query error (missing table, syntax) is an alert, not a retry.
- Large lists paginate, sort and filter on the server. Never load a whole table into the client.
- Store timestamps in UTC; display in the tenant time zone (default America/Sao_Paulo).
- Use the Sophos DS 2026 tokens; never hard-code colours. Headlines Zalando Sans Expanded Regular (never bold), body Zalando Sans, CTAs are full pills. Status always shows a word and an icon, never colour alone.
- Text from extensions and packages (names, descriptions) is untrusted: render as plain text.
- Only metadata of unknown titles (kind, source, match_key, name, vendor, description) may go to the Hub, and only when the "Share unknown titles with the hub" switch is on. Never hostnames, users, tenant names or install counts.

## Sophos limits the scheduler must respect

- 10 runs per minute per tenant; 1,000 runs per day on Live Endpoint Search (shared with scheduled queries), 500 on the REST API.
- At most 4 active runs per tenant; a run lasts up to 600 s; results pages hold up to 1,000 rows.
- The Endpoint API has no reliable `online` field: whether a computer was collected comes from its per-endpoint result. Live Endpoint Search's `liveDiscoverEndpointSearch(input: { ids }) { items { id online } }` does report it (lab, Oct 27, 2026: `true` only for the endpoint answering queries, even when another had a fresher `lastSeenAt`). Capability probes use it and never start on an offline computer (`provider.onlineEndpoints`; the REST fallback cannot tell, so it starts no probe).
- Online/offline filter on every collection: after claiming a batch the collector runs only the online computers; offline ones go to `defer_offline_tasks` (status `retry_scheduled`, no attempt counted, no run spent) with the next check from `nextOfflineCheck` (every hour the same day in the tenant time zone, then the next daily window). A task already scheduled for later is not claimed, so it keeps its schedule. `no_response` retries the same day too, and from the 3rd attempt at the next daily window. With the REST fallback (no online status) runs go to every due computer and a warning is logged.
- Cancel a run after `run_grace_minutes` (default 10) and send silent computers to the daily retry. Keep 20% of the daily budget for retries and Scan now.
- On 429 and 5xx: exponential backoff with jitter, honour `Retry-After`.

## Categories

- Categories come from the Hub through `dictionary_cache` and `categories_cache`, read-only. A title's category is a level-2 category; level 1 is its parent.
- Classification order: local override > dictionary exact match on (kind, source, match_key) > "Unclassified (sent to hub)". Show the origin under the category ("Hub · reviewed", "Hub · Jev 0.97", "Local override", "Unclassified").
- Attention levels: `info`, `review`, `not_allowed`. "Needs attention" lists only `review` and `not_allowed`.
- Seed saved search: "Remote access & tunnels" = level 1 Remote access + Proxy and tunnel.

## How to work here

- Plan mode first on Phases 1, 4 and 5; show the SQL and the step list before writing code.
- Each phase ends with a passing build, passing tests and a short note in `docs/phases/README.md` (tick the box, list follow-ups).
- Phase 5 tests use `fixtures/extensions_lab-pc01.csv`: 72 rows, 57 after dedupe by path, 48 installations, 23 extension IDs.
- Before Phase 4 against a real tenant, run the lab checks in `docs/spec.md` › "Riscos e pontos a validar" (offline endpoints inside a run, Live Endpoint Search URL and statuses, least-privilege API role, osquery tables per platform).
- Until the Hub runs through Phase H2, use the local mock (`npm run mock:hub`), which follows the contract in `docs/phases/hub-H2-client-api.md`.
- Secrets this app uses are listed in `.env.example`.
- The Sophos Central credential is set by an admin in Settings and stored in Vault. The browser can set, replace or remove it (`set_sophos_credential`, `clear_sophos_credential`) and read only a masked status (`get_sophos_connection_status`); only the service role can call `get_sophos_credential`. Never log, audit or return the secret.
