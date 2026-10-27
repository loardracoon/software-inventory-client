# Phase H3: classification with Jev (Lovable AI), manual or automatic

From `docs/spec.md`, section "Prompts do Hub" ("Fase H3: Jev manual e automático"). Plan first, implement, then verify with build and tests before the next phase.

> **Repo note:** Confirm the Jev model identifier and the Lovable AI gateway call in the Lovable docs before coding the adapter; keep it behind `ai_gateway`.

Phase H3: classification with Jev (Lovable AI), manual or automatic.
- Every call goes through the ai_gateway module from Phase H5 (mode and budget checks, logging, pause rules).
- Settings > Engines > Jev: mode off | manual | automatic.
- Manual: Inbox > New titles, multi-select, "Run Jev on selected" (max 50 per run).
- Automatic: a scheduled job every 6 hours takes up to 50 pending entries reported by at least 2 clients, highest reports_count first, only if the Jev budget allows; it is skipped while Jev is paused.
- Input per entry: "<kind> from <source>: <canonical_name> by <vendor>. <description>" plus the 71 level-2 categories as the options, each written as "<level 1> / <level 2>: <description>", including Other / Other. If accuracy drops, classify in two steps: level 1 first, then level 2 within it. Store category and probability in classification_results.
- Auto-publish a result only when all of these hold: probability >= 0.95; the proposed category and the current category both have attention_level info; the entry has no manual revision; no reclassification request is open for it; fewer than 100 auto-publishes today. Mark it method jev_auto and list it under Engines & usage > Auto-published with a one-click Revert that creates a new revision.
- Everything else becomes a proposal. Proposals view: grouped by category, probability bar, Accept per row, Change category inline, and "Accept all above 0.85" that skips categories with attention_level review or not_allowed.
- "Re-run Jev" on selected published entries or a whole category after a taxonomy change. Results arrive as proposals; the auto-publish gate never applies to entries with a manual revision.
