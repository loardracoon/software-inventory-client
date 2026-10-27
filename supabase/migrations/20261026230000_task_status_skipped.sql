-- Phase 4: a task whose query needs osquery tables the agent lacks is skipped (not counted in
-- coverage). Separate migration: a new enum value cannot be used in the transaction that adds it.
alter type public.task_status add value if not exists 'skipped';
