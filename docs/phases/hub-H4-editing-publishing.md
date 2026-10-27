# Phase H4: dictionary editing, publishing and reclassification requests

From `docs/spec.md`, section "Prompts do Hub" ("Fase H4: edição, publicação e pedidos"). Plan first, implement, then verify with build and tests before the next phase.

Phase H4: dictionary editing, publishing and reclassification requests.
- Dictionary: server-side table (canonical name, kind, source, match_key, category, method, confidence, revision, reports_count, status) with trigram search and filters.
- Entry page: edit canonical name, vendor, description, category and attention override. Saving asks for a change reason and creates a revision. "Publish" writes a dictionary_events row (next seq). Show revision history, Jev results and related requests from all clients, grouped.
- Inbox > Requests: open requests with client, title, current and suggested category, reason and age; requests for the same entry are grouped with a count. Actions: Accept and publish, Edit and publish, Run Jev, Reject with note. Every decision writes audit_log and is returned to the client by GET reclassification-requests.
- Email immediately for each new request; daily digest at 08:00 (America/Sao_Paulo) with new pending titles and their report counts.
- Taxonomy page: edit category names and descriptions (revisioned and published like entries); deprecating a category requires choosing the replacement for its entries.
