# Phase H1: schema

From `docs/spec.md`, section "Prompts do Hub" ("Fase H1: banco de dados"). Plan first, implement, then verify with build and tests before the next phase.

> **Repo note:** Seed from `docs/taxonomy.csv` in this repo.

Phase H1: schema. Migrations only, plus generated types.
- categories(id, name, slug, description, attention_level enum info|review|not_allowed, parent_id, sophos_firewall_category, revision, seq, deprecated). Two levels: parent_id null is level 1, named after the Sophos Firewall application categories where one exists. Seed from the attached taxonomy.csv (level1, level2, slug, attention_default, sophos_firewall_category, description, examples): 29 level-1 and 71 level-2 categories. entries.category_id always points to a level-2 category.
- entries(id, kind enum program|extension|ide_extension|package, source, match_key, canonical_name, vendor, description, category_id, attention_override, confidence, method enum rule|jev|manual, model_version, status enum pending|proposed|published|deprecated, revision, seq, reviewed_by, reviewed_at, reports_count, first_reported_at, last_reported_at, unique(kind, source, match_key)).
- entry_revisions(entry_id, revision, snapshot jsonb, changed_by, change_reason, created_at).
- dictionary_events(seq bigserial primary key, entry_id null, category_id null, type enum published|reclassified|description_changed|deprecated|category_changed, created_at).
- clients(id, name, contact_email, key_prefix, key_hash, status enum active|revoked, created_at, last_seen_at, last_seq).
- submissions(id, client_id, kind, source, match_key, name, vendor, description, received_at).
- reclassification_requests(id, public_id text unique like REQ-0001, client_id, entry_id, current_category_id, suggested_category_id, reason, evidence_url, status enum open|accepted|rejected|superseded, admin_note, created_at, decided_at, decided_by).
- classification_runs(id, model, started_by, started_at, finished_at, entry_count, status), classification_results(run_id, entry_id, category_id, probability, accepted, accepted_by, accepted_at).
- notifications(id, type, ref_id, title, read_at, created_at), hub_admins(user_id), audit_log(id, user_id, action, target, data jsonb, created_at).
- pg_trgm GIN indexes on entries.canonical_name, vendor and match_key.
