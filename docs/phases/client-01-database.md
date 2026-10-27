# Phase 1: database schema

From `docs/spec.md`, section "Prompts do cliente" ("Fase 1: banco de dados e RLS"). Plan first, implement, then verify with build and tests before the next phase.

Phase 1: database schema. Create migrations only, plus generated TypeScript types.

Enums: platform (windows, macos, linux); domain (hardware, disks, programs, extensions, ide_extensions, packages); title_kind (program, extension, ide_extension, package); task_status (pending, dispatched, collected, no_response, retry_scheduled, missed, error); change_type (added, removed, updated); attention_level (info, review, not_allowed).

Tables:
- tenants(id, sophos_tenant_id unique, name, id_type, data_region_host, created_at)
- tenant_members(user_id, tenant_id, role) for per-tenant access
- computers(id, tenant_id, sophos_endpoint_id unique, hostname, platform, os_name, os_version, os_build, associated_user, health, last_seen_at, last_collected_at, retired_at, missing_syncs int default 0)
- hardware_versions(id, computer_id, attrs jsonb, row_hash, valid_from, valid_to)
- software_titles(id, kind, source, canonical_name, vendor, external_id, unique(kind, source, canonical_name, external_id))
- installations(id, computer_id, title_id, domain, scope_key, version, path, attrs jsonb, row_hash, valid_from, valid_to, first_seen_snapshot, last_seen_snapshot)
- categories(id, name, description, attention_level), category_rules(id, category_id, field, match_type, pattern, kind_filter, priority, enabled), title_categories(title_id, category_id, rule_id null, assigned_by)
- scan_settings(tenant_id pk, cycle_weekday, cycle_time, retry_time, timezone, batch_size, max_active_runs, runs_per_minute, daily_run_limit, reserve_pct, run_grace_minutes, provider)
- scan_cycles(id, tenant_id, opened_at, closes_at, closed_at, status, coverage_pct)
- scan_tasks(id, cycle_id, computer_id, domain, status, priority, attempts, next_attempt_at, last_run_id, last_error, updated_at, unique(cycle_id, computer_id, domain))
- query_catalog(id, domain, platform, version, name, sql, required_tables text[], enabled)
- platform_capabilities(tenant_id, platform, osquery_tables text[], probed_at)
- query_runs(id, tenant_id, sophos_run_id, provider, domain, platform, query_version, endpoint_ids uuid[], status, started_at, finished_at, cancelled)
- raw_results(id, run_id, computer_id, rows jsonb, row_count, received_at)
- snapshots(id, computer_id, domain, scan_task_id, query_version, collected_at, row_count, content_hash, is_baseline)
- change_events(id, computer_id, title_id, domain, change, from_version, to_version, snapshot_id, detected_at)
- api_budget(tenant_id, minute timestamptz, runs int), collector_logs(id, step, tenant_id, level, message, data jsonb, created_at), audit_log(id, user_id, action, target, data jsonb, created_at)

Indexes: installations(computer_id) where valid_to is null; installations(title_id) where valid_to is null; installations(valid_from, valid_to); scan_tasks(status, next_attempt_at); change_events(detected_at desc); pg_trgm GIN on software_titles.canonical_name, vendor, external_id.

Views: current_installations (valid_to is null); materialized view title_summary(title_id, kind, source, canonical_name, vendor, categories, computers, versions, latest_version, first_seen) with a unique index for concurrent refresh.

RLS: viewers and analysts read rows of tenants they belong to; only admins write scan_settings, categories and category_rules; raw_results, api_budget and collector_logs are admin-read only; viewers see associated_user and username masked through a security-barrier view.
