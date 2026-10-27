# Phase 6: screens

From `docs/spec.md`, section "Prompts do cliente" ("Fase 6: telas"). Plan first, implement, then verify with build and tests before the next phase.

> **Repo note:** The mock screens are in `design/mock/*.dc.html` (see `design/README.md`). Use the two-level category display from the mock: level 1 small above level 2, with an attention badge for Review and Not allowed.

> **Repo note (from Phases 1–5):** Read computers and installations through `v_computers`, `v_installations` and `current_installations` (usernames masked for viewers), titles through `v_title_summary` (refreshed at most every 5 minutes; per tenant) and `title_classification`; changes from `change_events` (no events for baselines: the first collection of each computer and query, and new query versions); hardware from `hardware_versions` (`domain` hardware or disks; disk `free_space` is refreshed on the open row). "As of" a date: `valid_from <= t and (valid_to is null or valid_to > t)`. Cycle progress, retry queue and runs come from `scan_cycles`, `scan_tasks` (statuses include `skipped`, with the reason in `last_error`) and `query_runs`; the API budget from `budget_snapshot()` (service role) or `api_budget` (admins); Scan now calls `rpc('scan_now', { p_computer_id })`.

Phase 6: screens. Follow the attached mock screenshots (Sophos Design System 2026). Wire every screen to real data with server-side paging.

- Overview (/): KPIs (computers, current cycle coverage, software titles, extensions, packages, changes in the last 7 days); current cycle card with collected / retrying / missed / error counts and the next retry time; "Needs attention" list from categories with attention_level review or not_allowed; weekly added / removed / updated chart (last 12 weeks); latest changes.
- Computers (/computers): table with hostname, user, OS, platform, last collected, cycle status badge (with next retry), counts of programs / extensions / packages, attention categories. Filters: platform, status, category present, search.
- Computer detail (/computers/:id): header with OS, user, last seen, last collected and Scan now; hardware card; tabs Programs, Extensions, Packages, History; an "As of" date picker that shows the inventory at that date using valid_from/valid_to.
- Software (/software): one search box plus filters (kind, category chips, source, platform, user, version below, installed on date). Results grouped by title from title_summary. Title page (/software/:titleId): version distribution, computers list, change history.
- Changes (/changes): event log with filters (change type, kind, category, date range) and CSV export.
- Scans (/scans): current cycle progress, retry queue (computer, domain, attempts, next attempt, last error), recent runs (provider, domain, platform, endpoints, collected, no response, duration) and the schedule settings for admins.
All tables must stack or scroll horizontally at phone width.
