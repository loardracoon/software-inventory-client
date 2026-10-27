# Phase 8: hardening

From `docs/spec.md`, section "Prompts do cliente" ("Fase 8: endurecimento"). Plan first, implement, then verify with build and tests before the next phase.

Phase 8: hardening.

- Alerts: an Edge Function that sends an email or webhook when a cycle closes below 90% coverage, when a query returns an error, or when the collector has not run for 30 minutes.
- Scans page: an API budget panel (runs this minute, today, reserve left) from api_budget.
- Retention job (daily pg_cron): delete raw_results older than 90 days; keep everything else.
- SSO: Supabase SAML with Entra ID; map groups to roles.
- Playwright smoke tests for each route; SQL tests for apply_snapshot and RLS (a viewer cannot read raw_results or another tenant's rows).
- README: setup, secrets, cron, how to add a query version, how to rotate the Sophos credential.
