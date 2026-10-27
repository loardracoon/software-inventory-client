# Phase 7: dictionary from the Dictionary Hub, reclassification requests, saved searches and exports

From `docs/spec.md`, section "Prompts do cliente" ("Fase 7: dicionário do Hub, pedidos de reclassificação e exportação"). Plan first, implement, then verify with build and tests before the next phase.

> **Repo note:** Seed the saved search as "Remote access & tunnels" (level-1 categories Remote access + Proxy and tunnel). The Hub API contract is `docs/phases/hub-H2-client-api.md`.

Phase 7: dictionary from the Dictionary Hub, reclassification requests, saved searches and exports.

The category dictionary belongs to a separate app (Dictionary Hub). This app only reads it and sends suggestions.
- Secrets: HUB_URL, HUB_CLIENT_KEY. Settings > Dictionary shows the hub URL, the last synced seq and time, and a switch "Share unknown titles with the hub" (default on).
- Tables: dictionary_cache(kind, source, match_key, canonical_name, vendor, description, category_id, category_name, attention_level, confidence, method, revision, status), categories_cache, hub_sync_state(last_seq, synced_at, last_error), hub_submissions(kind, source, match_key, name, vendor, description, first_seen, sent_at), reclassification_requests(id, hub_request_id, title_id, current_category, suggested_category_id, reason, evidence_url, status, admin_note, created_by, created_at, updated_at), local_overrides(title_id, category_id, note, created_by, created_at).
- Edge Function hub-sync, run by pg_cron every 6 hours and after each ingest: page GET {HUB_URL}/functions/v1/dictionary-changes?since=<last_seq> with Authorization: Bearer HUB_CLIENT_KEY, upsert the cache, drop deprecated entries and reclassify the affected titles. Then, if sharing is on, POST unsent hub_submissions to titles-submit (only kind, source, match_key, name, vendor, description; never hostnames, users, tenant names or install counts). Then GET reclassification-requests for open requests and store status and admin_note.
- Classification of a title: local override > dictionary_cache exact match on (kind, source, match_key) > "Unclassified (sent to hub)". Show the origin under the category: "Hub · reviewed", "Hub · Jev 0.91", "Local override" or "Unclassified".
- Action "Request reclassification" on Software rows, the title page and the Extensions tab of a computer. A dialog shows the current category (read-only), a suggested category (categories_cache plus Other), a required reason (max 500 chars) and an optional evidence URL. Submit calls POST {HUB_URL}/functions/v1/reclassification-requests, stores the returned REQ id and marks the row "Reclassification requested". The title page lists its requests with status and the admin's note.
- Admins of this app can set a local override; it stays in this app and is labelled "Local override".
- If the hub is unreachable, keep classifying from the cache, retry with exponential backoff and show "Dictionary sync delayed" on the Scans page.
- Saved searches: save the current /software filters with a name and pin them to the sidebar; seed "Remote access & VPN".
- CSV export for Computers, Software results, a title's computers and Changes, generated on the server and logged in audit_log.
