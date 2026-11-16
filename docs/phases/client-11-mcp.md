# Phase 11: MCP server (queries, reports, policy and risk suggestions)

Plan first. Show the migration SQL, the router change, the tool list with each tool's RPC and the auth flow before writing code. Build the steps (M0–M7) in order; each one ends with a passing build and tests.

## Goal

An MCP server lets an AI assistant (Claude Desktop, Claude Code, Claude.ai connectors, other MCP clients) answer questions about the inventory, write reports, and suggest policy rules and risks, **as the signed-in user**, with the same tenant access, roles and masking as the console. It adds no new source of truth: every tool calls the views and RPCs that the screens already use.

| Area | What the assistant can do |
| --- | --- |
| Queries | Overview, software search, computer and title detail, changes, cycle coverage, vulnerabilities, end of life |
| Reports | Weekly summary, policy posture, coverage, evidence package from `audit-report` |
| Policy | Read the published policy and the draft, test a title, **simulate a rule's impact**, create and edit rules **in the draft only** |
| Risks | Derived risk views (see "Risks") and rule suggestions that answer a risk |

## Decisions (Nov 16, 2026)

1. **Auth: personal tokens first (M1), OAuth later (M6).** Tools never see how the caller was authenticated (one `resolveCaller` interface).
2. **Masking: viewer level by default for everyone, admins included.** Usernames, user scope and user folders in paths stay masked in MCP results unless an admin turns on "Show usernames to AI assistants" (audited). Reason: MCP results go to the model provider, and this app promises that nothing about the computers leaves the Supabase project unless an admin chooses so (same idea as the Hub sharing switch).
3. **Risks are derived first.** No `risks` table in this phase; a risk register is a later, optional phase.
4. **Policy writes: draft only.** The MCP never publishes, never discards a draft and never fills `risk_accepted_by`. Publishing stays in the console, done by a person.

## Rules that must not break

- The MCP calls PostgREST and RPCs with the **caller's JWT**, never with the service role, so RLS, `my_tenant_roles()` and masking apply. The only service-role calls are token lookup and the MCP audit insert.
- Nothing is returned while the installation's "Allow AI assistants (MCP)" switch is off (default off). The `initialize` handshake still works and the tools answer with a clear "turned off by your admin" error.
- Every tool call writes `mcp_audit` (user, token id, tool, arguments without secrets, row count, duration, outcome). Never the result content.
- Large results paginate on the server: every list tool takes `limit` (default 50, max 200) and `cursor`/`offset`, and says how many rows exist. Never return a whole table.
- Text from extensions and packages (names, descriptions, paths) is untrusted and may hold prompt injection. Return it only inside structured JSON fields, never in prose the server writes, and say so in each tool description.
- Classes, rules and MCP data never go to the Hub (same as Phase 9).
- Two production layouts run the same images: every image, env and secret change goes into both `deploy/k3s/app/stack.yaml` and `deploy/compose/docker-compose.yml`.
- Code, comments, tool names and descriptions in English.

## Architecture

- Edge Function `supabase/functions/mcp/` in the existing functions image. Public URL: `<PUBLIC_URL>/functions/v1/mcp` (production: `https://inventory.sophizo.com.br/functions/v1/mcp`).
- Transport: MCP **Streamable HTTP, stateless**, JSON responses (no long-lived SSE; Cloudflare and the 150 s worker timeout sit in front). `@modelcontextprotocol/sdk@1.32.2` with `WebStandardStreamableHTTPServerTransport` (`sessionIdGenerator: undefined`, `enableJsonResponse: true`), a new server and transport per request; `GET` and `DELETE` answer 405 (M0 findings 4–5).
- Pure tool logic in `supabase/functions/_shared/mcp/` (runtime-neutral, Vitest), Deno glue in `mcp/index.ts`. Policy simulation reuses `_shared/policy.ts`: it stays the only place that decides a class.
- `verify_jwt = false` for `mcp` (it authenticates callers itself): `supabase/config.toml` and `NO_VERIFY_JWT` in both layouts.
- Rate limit: new `RL_MCP_RATE` / `RL_MCP_BURST` in `deploy/k3s/nginx.conf.template` (a `location /functions/v1/mcp` before the generic one), defaults in `deploy/k3s/web.Dockerfile`, and every `rate-limits.env` (`deploy/k3s/app/`, `deploy/compose/`, `deploy/vps/`; see `docs/rate-limits.md`).

### Auth with personal tokens (M1)

1. An admin, operator or viewer creates a token in Settings › AI assistants: name, scope (`read`, or `policy_draft` for admins), expiry (max 90 days). The token (`eimcp_` + 32 random bytes, base64url) is shown once; only its SHA-256 is stored.
2. The client sends `Authorization: Bearer eimcp_…`. The function looks up the hash (service role RPC `mcp_token_resolve`: not revoked, not expired, user still exists; updates `last_used_at`).
3. The function signs a **5-minute HS256 JWT** for that user (`sub`, `role: authenticated`, `aud: authenticated`, `exp`) and calls PostgREST with it.
4. Router change: `deploy/k3s/functions/main/index.ts` keeps removing `JWT_SECRET` from every worker **except `mcp`**. A test pins that other workers still do not get it.
5. Hosted Supabase (the `supabase/` project): the function needs the legacy JWT secret as a function secret (`MCP_JWT_SECRET`). Check in M0 that the project still accepts HS256 tokens; with asymmetric signing keys only, M1 needs the OAuth path or a GoTrue session instead.

### OAuth (M6)

- M0 confirmed that the deployed GoTrue has the OAuth 2.1 server (off today). Turn it on with dynamic client registration and a console consent route, fix its issuer (M0 findings 1–2), and use it: `mcp` serves Protected Resource Metadata (`/.well-known/oauth-protected-resource`) pointing at it, validates its access tokens, and Claude.ai can add the app as a custom connector.
- The consent screen is a console route (`GOTRUE_OAUTH_SERVER_AUTHORIZATION_PATH`) that lists the client, the scope and the masking setting.
- OAuth grants appear next to personal tokens in Settings › AI assistants and can be revoked there.

## Data model (migration `*_mcp.sql`)

- `mcp_settings` (one row): `enabled bool default false`, `show_usernames bool default false`, `updated_by`, `updated_at`. RPCs `get_mcp_settings` (members), `set_mcp_settings` (admins, audited).
- `mcp_tokens(id, user_id, name, token_hash bytea unique, scope mcp_scope ('read','policy_draft'), created_at, expires_at, last_used_at, revoked_at)`. RLS: a user reads their own rows (never the hash); admins read all. RPCs `mcp_token_create` (returns the token once; `policy_draft` only for admins), `mcp_token_revoke` (owner or admin), `mcp_token_resolve` (service role only). Audited without the token.
- `mcp_audit(id, at, user_id, token_id, tool, arguments jsonb, tenant_id, row_count, duration_ms, outcome, error)`. Admins read; inserts only by the service role; retention 180 days with a pg_cron purge (like `purge_raw_results`).
- Masking: when `show_usernames` is off, tools read through the viewer-masked views or pass `p_mask => true`. Where an RPC masks only by role, add a `p_force_mask boolean default false` parameter instead of new views.
- Revoke `anon` on everything new; pgTAP tests for each policy and RPC (token visibility, scope check, revoked and expired tokens, settings writes, audit insert path).

## Tools

Every tool takes an optional `tenant_id` (null = all visible tenants, like `useTenant()`), returns JSON with `data`, `total_count` when it is a list, and `as_of`.

| Tool | Reads | Step |
| --- | --- | --- |
| `get_overview` | `overview_stats`, `v_tenant_overview`, `cycle_overview` | M1 |
| `search_software` | `search_titles` (kind, category, attention, policy class, vuln filter, platform, version below, sort, paging) | M2 |
| `get_title` | `title_versions`, `title_vulns`, `title_policy`, `title_group_ids` | M2 |
| `list_computers`, `get_computer` | `v_computer_list`, `v_installation_details`, `computer_cycle_tasks` | M2 |
| `list_changes` | `v_change_log`, `weekly_changes` | M2 |
| `list_vulnerabilities` | `vuln_overview`, `v_vuln_findings`, `v_vuln_events` | M2 |
| `list_end_of_life` | the EOL columns of `title_versions`, `v_computer_list` and `overview_stats` (no EOL view of its own yet; add one in M2 if paging needs it) | M2 |
| `needs_attention` | `needs_attention` | M2 |
| `report_weekly`, `report_policy_posture`, `report_coverage` | the RPCs above, aggregated per tenant | M3 |
| `create_evidence_package` | `audit-report` function as the caller (returns report id, hash and download path) | M3 |
| `get_policy` | `policy_get`, `policy_overview`, `policy_rule_history` | M4 |
| `test_title_against_policy` | `policy_preview_inputs` + `explain()` from `policy.ts` | M4 |
| `simulate_rule` | `policy_preview_inputs` + `evaluate()` with the proposed rule placed at a position: pairs, titles and computers that change class, before → after | M4 |
| `list_risks` | derived risks (below) | M4 |
| `suggest_rule_for_risk` | a risk → a proposed rule (conditions, class, kinds, documentation fields left for a person) + its `simulate_rule` result; writes nothing | M4 |
| `draft_save_rule`, `draft_move_rule`, `draft_set_rule_enabled` | `policy_ensure_draft`, `policy_save_rule`, `policy_move_rule`, `policy_set_rule_enabled` (admins, token scope `policy_draft`) | M5 |

Not exposed: `policy_publish`, `policy_discard_draft`, `policy_delete_rule`, `policy_set_default_class`, `scan_now`, Settings, users, credentials, `export_csv` (the console keeps exports and their audit).

Resources: taxonomy (`docs/taxonomy.json`), policy fields and operators (from `policy.ts`), the published policy as JSON (`policy_json`). Prompts: "Weekly report", "Policy review for a category", "Review overdue exceptions", "Explain a computer's risk".

## Risks (derived, M4)

`list_risks` returns one row per risk with `kind`, `severity` (critical, high, medium, low), `subject` (title, version, rule), affected computers, evidence and a suggested next step. Kinds:

| Kind | Source | Severity |
| --- | --- | --- |
| `kev_installed` | certain KEV matches without a rule that makes them unsanctioned | critical |
| `critical_vuln` | certain CVSS ≥ 9 or EPSS ≥ 0.5 matches | high |
| `eol_installed` | installed versions past end of life | high |
| `unsanctioned_installed` | titles classed unsanctioned still installed | high |
| `exception_overdue` | tolerated rules with `review_by` in the past | medium |
| `exception_incomplete` | tolerated rules in the draft missing owner, purpose, controls, acceptance or review date | medium |
| `unclassified_attention` | `review` / `not_allowed` titles with no explicit rule | low |

"Uncertain" vulnerability matches never count (same rule as the policy fields). Thresholds live in one module (`_shared/mcp/risks.ts`) with tests.

## Steps

- **M0 — lab checks.** Done Nov 16, 2026 except the hosted-project check; see "M0 findings".
- **M1 — skeleton.** Migration, router exception, `mcp` function with `initialize`, `tools/list` and `get_overview`, token auth, audit, settings switch, rate limit, both deploy layouts, Settings › AI assistants (switch, show usernames, tokens: create, list, revoke). Built Nov 16, 2026; see "M1 notes". The Protected Resource Metadata (`/.well-known/oauth-protected-resource`) moved to M6: with personal tokens only it would point clients at an OAuth flow that does not exist yet.
- **M2 — queries.** The query tools, paging and masking tests. Built Nov 16, 2026; see "M2 notes".
- **M3 — reports.** Report tools and the evidence package.
- **M4 — policy and risks, read only.** `get_policy`, tester, `simulate_rule`, `list_risks`, `suggest_rule_for_risk`.
- **M5 — draft writes.** Draft tools behind admin + `policy_draft` scope; the console's draft bar shows the change and who made it (audit says `via MCP`).
- **M6 — OAuth.** As described above.
- **M7 — finish.** `docs/operations.md` › AI assistants (connect Claude Desktop / Claude Code / Claude.ai, rotate tokens, turn off), `README.md`, notes here.

## M0 findings (Nov 16, 2026, production VPS, read-only checks)

1. **GoTrue already ships the OAuth 2.1 server, turned off.** The deployed `gotrue:v2.197.0` binary has `/oauth/authorize`, `/oauth/token`, `/oauth/clients/register` and the `oauth_clients` / `oauth_authorizations` / `oauth_consents` migrations. Config keys (envconfig prefix `OAUTH_SERVER`, split words): `GOTRUE_OAUTH_SERVER_ENABLED`, `GOTRUE_OAUTH_SERVER_ALLOW_DYNAMIC_REGISTRATION`, `GOTRUE_OAUTH_SERVER_AUTHORIZATION_PATH` (the console route that shows the consent screen). None is set today; `/.well-known/oauth-authorization-server` under `/auth/v1/` answers 404. **M6 uses GoTrue; no own authorization server.**
2. **GoTrue discovery is incomplete.** `/auth/v1/.well-known/openid-configuration` returns `"issuer": ""` and relative endpoints (`/oauth/authorize`, `/oauth/token`), and `/auth/v1/.well-known/jwks.json` is empty (HS256 only). M6 must set `GOTRUE_API_EXTERNAL_URL` / `GOTRUE_JWT_ISSUER` to `<PUBLIC_URL>/auth/v1` in both layouts, and `mcp` validates GoTrue's OAuth access tokens with the JWT secret (it already has it from M1).
3. **The root `/.well-known/*` paths return the SPA.** `/.well-known/oauth-protected-resource`, `…/functions/v1/mcp` and `/.well-known/oauth-authorization-server` all answer `200 text/html` (the console's `index.html`), which MCP clients would misread. The gateway template needs exact locations before `location /`: `/.well-known/oauth-protected-resource` (and the `/functions/v1/mcp` suffix) → the `mcp` function; `/.well-known/oauth-authorization-server` (and the `/auth/v1` suffix) → GoTrue's metadata. Part of M1 for the resource metadata, M6 for the server metadata.
4. **The MCP SDK runs in Edge Runtime.** `@modelcontextprotocol/sdk@1.32.2` (`McpServer` + `WebStandardStreamableHTTPServerTransport`, `sessionIdGenerator: undefined`, `enableJsonResponse: true`) with `zod@3.25.76`, run in a throwaway container from the production functions image behind the real `main` router: `initialize`, `tools/list` and `tools/call` answered correctly; warm calls 3–6 ms. Use the SDK.
5. **A stateless server must refuse GET.** A `GET` with `Accept: text/event-stream` opened a stream that never closed (the probe had to be stopped). `mcp/index.ts` answers `GET` and `DELETE` with `405 Method Not Allowed` before the transport, so no idle stream ties up a worker or a Cloudflare connection.
6. **Cloudflare passes the MCP request through.** A `POST` to `<PUBLIC_URL>/functions/v1/mcp` with `Authorization`, `Accept: application/json, text/event-stream` and `MCP-Protocol-Version` reached the functions router (404 JSON "Function not found", 0.13 s). With JSON responses there is no stream for Cloudflare to buffer. Streaming itself was not tested (no function deployed).
7. **Hosted Supabase (HS256 acceptance) not checked**: this installation is self-hosted. Check it before running M1 on a hosted project.

## M1 notes (Nov 16, 2026)

- Migration `20261117100000_mcp.sql`: `mcp_scope`, `mcp_settings` (off, usernames masked), `mcp_tokens` (sha256 only, last 4 characters as hint, 1–90 days, revocation), `mcp_audit` (admins read, service role inserts, `mcp-audit-retention` pg_cron at 04:45 UTC, 180 days); RPCs `get_mcp_settings`, `set_mcp_settings`, `mcp_token_list`, `mcp_token_create`, `mcp_token_revoke` (audited, never with the token) and `mcp_token_resolve`, `purge_mcp_audit` (service role). `src/integrations/supabase/types.ts` got the new RPCs by hand: run `npm run db:types` on a local stack to regenerate it.
- Function `supabase/functions/mcp/` with `_shared/mcp/auth.ts` (token format, sha256, HS256 user JWT), `audit.ts` (secrets removed by key name, 8 KB cap), `tools.ts` (`get_overview`: `v_tenant_overview`, `overview_stats`, `cycle_overview`). Responses are sent whole with `Content-Length` (a streamed body hung behind an HTTP/1.0 proxy in the end-to-end test).
- Router: `_shared/worker-env.ts` decides each worker's environment; only `mcp` gets `MCP_JWT_SECRET`. `deno check` of `deploy/k3s/functions/main/index.ts` reports a TS2345 at `crypto.subtle.verify` that predates this phase (the repo's `functions:check` does not check `main/`).
- Wiring: `[functions.mcp] verify_jwt = false`, `mcp` in `NO_VERIFY_JWT` (k3s, compose, vps), `location = /functions/v1/mcp` with `RL_MCP_RATE` / `RL_MCP_BURST` (defaults in `web.Dockerfile`, all three `rate-limits.env`, docs).
- Console: Settings › AI assistants (`src/features/mcp/`).
- Checked: 26 pgTAP (`mcp.test.sql`, on a throwaway Postgres with the production schema), 22 new Vitest (381 in all), lint, build, `deno check` of `mcp`, `nginx -t` of the rendered template. End to end on a throwaway stack (production functions image and router, PostgREST v16.5, the production schema): no token, a JWT and an unknown token → 401; GET → 405; `initialize` and `tools/list` while off; `get_overview` while off → tool error and audit `disabled`; on → admin and viewer each get their own role; unknown tenant → tool error and audit `error`; revoked token → 401; `last_used_at` stamped. Not checked: Playwright for the card, the 429 of the new limit, a real MCP client (Claude Desktop / Claude Code).
- Deploying on the VPS (`/opt/endpoint-inventory`): `update.sh` pulls images and runs migrations but does not change `docker-compose.yml`, so add `,mcp` to `NO_VERIFY_JWT` in the copy there before the first build with this phase, or every MCP call gets 401 "Invalid JWT" from the router.

## M2 notes (Nov 16, 2026)

- **Masking without new views.** Migration `20261117100100_mcp_masking.sql`: `mcp_masked()` reads the JWT claim `mcp_mask`, and `my_tenant_roles()` reports `viewer` for every visible tenant while it is true. Every view and screen RPC already masks users, user scope and user folders for viewers through `my_tenant_roles()`, so nothing else changed. The mcp function puts the claim in its read JWT while "Show usernames to AI assistants" is off; only a JWT signed with the project secret can carry it. Side effect, stated in the `get_overview` description: while masked, `your_role` reads `viewer`. The `search_titles` user filter is not exposed (it would let an assistant probe masked usernames).
- **Tools** (`_shared/mcp/tools.ts`, registered with zod schemas in `mcp/index.ts`): `search_software` (`search_titles`), `get_software_title` (`v_title_summary`, `title_versions`, `title_vulns`, `title_group_ids`, `v_installation_details`), `list_computers` (`v_computer_list`, active only), `get_computer` (`v_computer_list`, `computer_cycle_tasks`, `v_installation_details`), `list_changes` (`v_change_log`, `weekly_changes` on the first page), `list_vulnerabilities` (`vuln_overview`, `v_vuln_findings`, open and overdue by default), `list_end_of_life` (software through `search_titles` `p_support`, operating systems through `v_computer_list.os_eol_status`), `needs_attention`. Lists take `limit` (default 50, max 200) and `offset` and return `page { total, limit, offset, returned, next_offset }`; hostname and name searches escape `%` and `_`; results that carry text from the computers include a `note` that it is data, not instructions; CVE summaries are cut to 500 characters and a title returns at most 100 CVEs.
- Checked: pgTAP 26 (`mcp.test.sql`) + 12 (`mcp_masking.test.sql`); Vitest 27 for the MCP modules; end to end on a throwaway stack with `e2e/fixtures/policy-seed.sql` plus a user on one computer and one extension: 19 checks (the 9 tools listed; paging; kind and hostname filters; title versions and computers across spellings; masked admin: no username, `user_masked`, `C:\Users\***` path, no "maria" anywhere in a computer result; shown: the admin sees the username, a viewer still does not; unknown id → tool error; limit 500 refused). Not checked: changes, findings and EOL with real rows (the seed has none; the queries ran and returned empty pages), a real MCP client.
- Production test with Claude (Nov 16, 2026, 10 calls, all ok, ≤ 138 ms): every computer's `vulnerabilities.top` carried uncertain Edge CVEs from 2015–2017 flagged KEV and critical, which an assistant reads as open known-exploited flaws. Fixed: `certainVulns()` keeps uncertain matches only as the `possible` count (computers and title versions); `list_computers` rows carry counts only (attention titles counted, no CVE list; about 2.5 KB a row before), `get_computer` keeps the titles and the certain top CVEs.
- Gap: a call that the SDK refuses by schema (for example `limit: 500`) never reaches the handler, so it is not written to `mcp_audit`.

## Tests

- pgTAP: every new policy and RPC; masking with `show_usernames` off for an admin token; viewer tokens cannot reach admin RPCs; draft RPCs refused for `read` tokens.
- Vitest: each tool handler against a mocked PostgREST, `simulate_rule` against the Phase 9 fixture (42 titles, 12 rules), risk thresholds, token format and hashing, JWT signing.
- Router test: only `mcp` gets `JWT_SECRET`.
- End to end on the isolated stack with the Sophos and Hub mocks: MCP Inspector (`npx @modelcontextprotocol/inspector`) lists tools, a viewer token sees masked users, the switch off refuses tools, a `policy_draft` admin token creates a draft rule that the console shows and that only a person can publish, revoked and expired tokens get 401, the rate limit answers 429.
- Playwright: Settings › AI assistants (create token shown once, revoke, switch).

## Done when

The build, `functions:check`, lint, pgTAP, Vitest and Playwright pass; Claude Desktop and Claude Code connect with a personal token and answer an overview question, a weekly report and a rule simulation on the isolated stack; OAuth connects from Claude.ai (M6); the box in `README.md` is ticked with a short note.
