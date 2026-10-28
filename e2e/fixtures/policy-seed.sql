-- Seed for e2e/policy.spec.ts on an isolated, empty stack (never on real data): one tenant, two
-- computers and five titles; Adobe Acrobat is installed in two versions so a version rule splits it.
insert into public.tenants (id, sophos_tenant_id, name, id_type) values
  ('e2e00000-0000-0000-0000-000000000001', 'e2e-tenant', 'E2E tenant', 'tenant');

insert into public.computers (id, tenant_id, sophos_endpoint_id, hostname, platform, os_name) values
  ('e2e00000-0000-0000-0000-0000000000c1', 'e2e00000-0000-0000-0000-000000000001', 'e2e-ep-1', 'E2E-PC-OLD', 'windows', 'Windows 11 Pro'),
  ('e2e00000-0000-0000-0000-0000000000c2', 'e2e00000-0000-0000-0000-000000000001', 'e2e-ep-2', 'E2E-PC-NEW', 'windows', 'Windows 11 Pro');

insert into public.software_titles (id, kind, source, match_key, canonical_name, vendor, external_id) values
  ('e2e00000-0000-0000-0000-0000000000a1', 'program', 'programs', 'adobe acrobat|adobe', 'Adobe Acrobat', 'Adobe', null),
  ('e2e00000-0000-0000-0000-0000000000a2', 'program', 'programs', 'adobe photoshop|adobe', 'Adobe Photoshop', 'Adobe', null),
  ('e2e00000-0000-0000-0000-0000000000a3', 'program', 'programs', '7-zip|igor pavlov', '7-Zip', 'Igor Pavlov', null),
  ('e2e00000-0000-0000-0000-0000000000a4', 'extension', 'chrome', 'inomeogfingihgjfjlpeplalcfajhgai', 'Chrome Remote Desktop', null, 'inomeogfingihgjfjlpeplalcfajhgai');

insert into public.installations (tenant_id, computer_id, title_id, domain, query_name, scope_key, version, row_hash, valid_from) values
  ('e2e00000-0000-0000-0000-000000000001', 'e2e00000-0000-0000-0000-0000000000c1', 'e2e00000-0000-0000-0000-0000000000a1', 'programs', 'inv.programs', '', '23.008', 'e2e-1', now() - interval '10 days'),
  ('e2e00000-0000-0000-0000-000000000001', 'e2e00000-0000-0000-0000-0000000000c2', 'e2e00000-0000-0000-0000-0000000000a1', 'programs', 'inv.programs', '', '25.001', 'e2e-2', now() - interval '10 days'),
  ('e2e00000-0000-0000-0000-000000000001', 'e2e00000-0000-0000-0000-0000000000c2', 'e2e00000-0000-0000-0000-0000000000a2', 'programs', 'inv.programs', '', '26.0', 'e2e-3', now() - interval '10 days'),
  ('e2e00000-0000-0000-0000-000000000001', 'e2e00000-0000-0000-0000-0000000000c1', 'e2e00000-0000-0000-0000-0000000000a3', 'programs', 'inv.programs', '', '24.09', 'e2e-4', now() - interval '10 days'),
  ('e2e00000-0000-0000-0000-000000000001', 'e2e00000-0000-0000-0000-0000000000c2', 'e2e00000-0000-0000-0000-0000000000a3', 'programs', 'inv.programs', '', '24.09', 'e2e-5', now() - interval '10 days'),
  ('e2e00000-0000-0000-0000-000000000001', 'e2e00000-0000-0000-0000-0000000000c1', 'e2e00000-0000-0000-0000-0000000000a4', 'extensions', 'inv.extensions', 'user01|Default', '124.0', 'e2e-6', now() - interval '10 days');

refresh materialized view public.title_summary;
