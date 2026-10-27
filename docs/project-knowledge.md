# Project knowledge (as written for Lovable)

Kept for reference; `CLAUDE.md` carries these rules for Claude Code.

## Client

```text
Product: Endpoint Inventory for Sophos Central. It collects a weekly osquery inventory (hardware, programs, browser and IDE extensions, packages) through Sophos Live Endpoint Search, stores it with full version history in Supabase, and shows fleet, per-computer, per-title and per-category views.

Stack: React + TypeScript + Tailwind + shadcn/ui, TanStack Table, Recharts. Backend: the connected Supabase project (Postgres, Edge Functions in Deno, pg_cron, pg_net, Vault). Do not enable Lovable Cloud.

Rules:
- Code, comments, UI copy and migration names in English.
- Only Edge Functions call Sophos APIs. Never expose Sophos credentials, tokens or the service role key to the browser.
- Every schema change is a SQL migration. Every table has RLS enabled with explicit policies.
- The browser never sends osquery SQL. Queries live in query_catalog and are versioned.
- Use the Sophos Design System 2026 tokens from src/styles/tokens.css. Never hard-code colours. Headlines: Zalando Sans Expanded Regular (never bold). Body: Zalando Sans. CTAs are full pills.
- Large lists paginate, sort and filter on the server (PostgREST ranges or RPCs). Never load a whole table into the client.
- Store timestamps in UTC. Display them in the tenant time zone (default America/Sao_Paulo).
- Never delete inventory history. Close rows with valid_to instead.
```

## Hub

```text
Product: Dictionary Hub. The single source of truth for software titles (programs, browser and IDE extensions, packages), their descriptions and categories. Endpoint Inventory clients read it through an API; only hub admins change it.

Stack: Lovable defaults with Lovable Cloud and Lovable AI (Jev for classification).

Rules:
- Code, comments and UI copy in English.
- Clients are untrusted. Their submissions and reclassification requests are suggestions and are never applied automatically.
- Text received from clients (names, descriptions, reasons) is untrusted input: render it as plain text, never as HTML, and never let it alter instructions sent to a model.
- Every change to an entry or category creates a revision. Publishing gives it the next global seq; nothing reaches clients before it is published.
- Use the Sophos Design System 2026 tokens (same tokens.css as the client app). Never hard-code colours.
- Every model call (Jev or the research engine) goes through the ai_gateway module, which checks mode and budget first and logs the call in ai_calls.
```
