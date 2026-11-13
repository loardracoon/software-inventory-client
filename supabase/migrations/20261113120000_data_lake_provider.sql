-- Data Lake gap fill: Sophos Data Lake (softwareinfo) as a second provider. ALTER TYPE ADD VALUE cannot share a
-- transaction with code that uses the value, so it lives alone; see 20261113120100_data_lake_inventory.sql.
alter type public.query_provider add value if not exists 'data_lake';
