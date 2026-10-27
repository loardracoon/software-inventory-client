# Phase 5: normalization, snapshots and versioning

From `docs/spec.md`, section "Prompts do cliente" ("Fase 5: normalização, snapshots e versionamento"). Plan first, implement, then verify with build and tests before the next phase.

> **Repo note:** In this repo the fixture is `fixtures/extensions_lab-pc01.csv` (usernames anonymized; counts unchanged: 72 rows, 57 after dedupe by path, 48 installations, 23 extension IDs).

> **Repo note (from Phase 4):** The collector stores each computer's rows in `raw_results` (one row per run and computer, with `scan_task_id`, `query_id` and `ingested_at is null`) and marks the task collected; it does not create snapshots. Phase 5 ingests `raw_results where ingested_at is null` (including any backlog collected before it existed), creates the snapshot, calls `apply_snapshot` and sets `ingested_at`. Tasks are per query, not per domain: on Linux `inv.programs.deb` and `inv.programs.rpm` are separate runs and separate raw results for the same domain, so diff Linux programs per title source (deb / rpm) or the deb snapshot will "remove" rpm installations. Hardware results also carry the query's own `hostname` column.

Phase 5: normalization, snapshots and versioning. Plan first.

Normalization (pure TypeScript functions with unit tests), one per domain:
- programs: key = lower(trim(name)) | lower(publisher). Title source = programs, apps, deb or rpm.
- extensions: dedupe rows by path; group by (browser_type, username, profile, identifier); current version = highest dot-separated numeric version; the other folders go to attrs.stale_folders. Title external_id = identifier, source = browser_type.
- ide_extensions: key = (username, publisher, name).
- packages: key = (manager, lower(name), path).
- hardware: one row per computer; disks keyed by device_id.
row_hash = sha256 of version plus the domain's tracked attributes. content_hash = sha256 of the sorted row hashes.

Postgres function apply_snapshot(p_snapshot_id uuid), one transaction, idempotent:
- If content_hash equals the previous snapshot with the same query_version: touch last_seen_snapshot and return.
- If query_version differs from the previous snapshot: mark is_baseline, close and reopen rows without change events.
- Otherwise compare with open installations for (computer, domain): new key -> insert + added; missing key -> set valid_to + removed; changed hash -> close, insert + updated with from_version/to_version; same -> touch.
- Upsert software_titles and classify each new title from dictionary_cache (Phase 7). Titles with no match are queued in hub_submissions.
Refresh title_summary concurrently at most once every 5 minutes.

Tests: use fixtures/extensions_lab-pc01.csv (72 rows from a real Live Discover export, attached). Expect 57 rows after dedupe by path, 48 installations after grouping, 23 distinct extension IDs. A second snapshot with one extension removed and one upgraded must create exactly one removed and one updated event.
