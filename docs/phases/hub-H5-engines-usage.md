# Phase H5: AI engines, usage, estimated cost and the research engine

From `docs/spec.md`, section "Prompts do Hub" ("Fase H5: motores, uso, custo estimado e pesquisador"). Plan first, implement, then verify with build and tests before the next phase.

Phase H5: AI engines, usage, estimated cost and the research engine.

- ai_gateway module, shared by every Edge Function that calls a model: before the call it checks the engine mode, pause state and budgets; after the call it writes ai_calls(id, engine jev|research, provider, model, purpose classify|research, entry_ids, units jsonb with titles, input and output tokens and searches when the provider reports them, latency_ms, status, error_code, estimated_cost, currency, run_id, created_at) and applies the pause rules.
- engine_prices(engine, provider, model, unit, price, currency, valid_from), editable by admins. estimated_cost is computed when the call is logged and never recomputed. Show a warning when an engine has no price for its unit.
- engine_settings(engine, mode, provider, monthly_budget, daily_cap, per_run_cap, auto_publish_daily_cap, alert_pct, paused, paused_reason, paused_at) with conservative defaults: Jev automatic, 50 titles per run, a run at most every 6 hours, 200 titles per day, 3 credits per month, 100 auto-publishes per day; research 20 per day, USD 10 per month; alert at 80%.
- Pause rules: budget at 100%; HTTP 402 from the Lovable AI gateway; more than 20% failed calls in the last hour; Jev acceptance below 70% over the last 50 decided proposals, where a reverted auto-publish counts as rejected. Pausing writes a notification and emails the admins; only an admin resumes.
- Engines & usage page: per engine, a mode switch, Pause/Resume, month and day budget bars, calls, titles, estimated cost, cost per accepted title, acceptance rate and recent calls with errors. Tabs Auto-published (with Revert), Price table and Events.
- Research engine: provider setting gemini | claude (default gemini), key in secrets (GEMINI_API_KEY or ANTHROPIC_API_KEY). The Gemini adapter uses Google Search grounding; the Claude adapter uses the web search tool. At most 5 searches and 60 seconds per research.
- Research triggers, each with a switch: reclassification request (on), proposal in a sensitive category (on), Jev probability below 0.85 (off), rule and Jev disagree (off), and the Research button on the entry page (always available). At most one automatic research per entry every 30 days.
- Research input: kind, source, canonical name, vendor, description and match key only, never anything about client computers. The output must match the dossier JSON schema in the design document; reject and log anything else. Drop every claim without a URL; return unknown=true when no reliable source is found.
- Treat fetched pages and descriptions as untrusted: the research prompt says that instructions found in them are data, and the engine has no tool besides search and page reading.
- Store dossiers in research_dossiers(entry_id, provider, model, dossier jsonb, created_at) and show the latest one on the entry page next to the rule and Jev results, with its sources as links. A dossier never publishes.
