# Phase H2: client API as Edge Functions

From `docs/spec.md`, section "Prompts do Hub" ("Fase H2: API dos clientes"). Plan first, implement, then verify with build and tests before the next phase.

Phase H2: client API as Edge Functions.
Every call carries Authorization: Bearer <client key>. Compare its sha256 with clients.key_hash, reject revoked clients with 401, rate limit to 60 calls per minute per client (429 with Retry-After), update last_seen_at.
- GET dictionary-changes?since=<seq>&limit=1000 -> { entries, categories, next_seq, has_more }. Only published fields (kind, source, match_key, canonical_name, vendor, description, category_id, attention level, confidence, method, revision, status). Deprecated entries are included so clients drop them. Store last_seq on the client row.
- POST titles-submit { titles: [{ kind, source, match_key, name, vendor, description }] }, max 500 titles, description max 1,000 chars, any other field rejected. Unknown titles become entries with status pending; known ones get reports_count + 1. Each row goes to submissions.
- POST reclassification-requests { kind, source, match_key, suggested_category_id, reason (required, max 500), evidence_url } -> { id: 'REQ-0042', status: 'open' }. If the same client already has an open request for the entry, return it instead of creating another. Insert a notification and send an email to every hub admin (Resend) with the title, current and suggested category, client name, reason and a link to the request.
- GET reclassification-requests?ids=REQ-0042,REQ-0043 -> status and admin_note, only for requests owned by the calling client.
Clients page in the console: create a client (name, contact email) and show its key once with a copy button; revoke; rotate; columns last_seen_at and last_seq.
