-- Stage 3: Windows patch state. ALTER TYPE ADD VALUE cannot share a transaction with code that uses the value, so it lives
-- alone; see 20261116100800_patches.sql.
alter type public.inventory_domain add value if not exists 'patches';
