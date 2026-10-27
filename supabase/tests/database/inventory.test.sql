-- Schema integrity: history rules, classification order, seed and helpers.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
-- Start from an empty app inside this transaction so data from local use cannot leak into the
-- assertions; the final rollback restores everything.
truncate public.tenants, public.software_titles, public.sophos_connection, public.audit_log,
  public.dictionary_cache, public.hub_submissions cascade;
delete from public.profiles;
delete from vault.secrets where name = 'sophos_client_secret';

select plan(16);

insert into public.tenants (id, sophos_tenant_id, name, id_type) values
  ('10000000-0000-0000-0000-00000000000a', 'sophos-a', 'Tenant A', 'tenant');
insert into public.computers (id, tenant_id, sophos_endpoint_id, hostname, platform) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'ep-a', 'host-a', 'windows');
insert into public.software_titles (id, kind, source, match_key, canonical_name) values
  ('30000000-0000-0000-0000-000000000001', 'extension', 'chrome', 'inomeogfingihgjfjlpeplalcfajhgai', 'Chrome Remote Desktop'),
  ('30000000-0000-0000-0000-000000000002', 'package', 'npm', 'left-pad', 'left-pad'),
  ('30000000-0000-0000-0000-000000000003', 'program', 'programs', 'obs studio|obs project', 'OBS Studio');
insert into public.installations (tenant_id, computer_id, title_id, domain, query_name, scope_key, version, row_hash, valid_from) values
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000001',
   'extensions', 'inv.extensions', 'user01|Default', '1.0', 'h1', now() - interval '1 day');

-- Seed and helpers -------------------------------------------------------------------------------
select is((select count(*) from public.categories_cache where level = 1), 29::bigint, '29 level-1 categories');
select is((select count(*) from public.categories_cache where level = 2), 71::bigint, '71 level-2 categories');
select is(
  (select count(*) from public.categories_cache c2 join public.categories_cache c1 on c1.slug = c2.parent_slug where c2.level = 2),
  71::bigint, 'every level-2 category has a level-1 parent');
select is(public.version_key('4.4.41_0'), '{4,4,41,0}'::numeric[], 'version_key splits numeric parts');
select ok(public.version_key('10.0.1') > public.version_key('9.9.9'), 'version_key orders numerically');
select ok(exists (select 1 from public.scan_settings where tenant_id = '10000000-0000-0000-0000-00000000000a'),
  'a new tenant gets default scan settings');
select throws_ok(
  $$update public.scan_settings set timezone = 'Mars/Olympus' where tenant_id = '10000000-0000-0000-0000-00000000000a'$$,
  '22023', null, 'unknown time zones are rejected');

-- History rules ----------------------------------------------------------------------------------
select throws_ok(
  $$insert into public.installations (tenant_id, computer_id, title_id, domain, query_name, scope_key, version, row_hash, valid_from)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
            '30000000-0000-0000-0000-000000000001', 'extensions', 'inv.extensions', 'user01|Default', '1.1', 'h2', now())$$,
  '23505', null, 'only one open row per computer, title and scope');
select throws_ok(
  $$insert into public.installations (tenant_id, computer_id, title_id, domain, query_name, version, row_hash, valid_from, valid_to)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
            '30000000-0000-0000-0000-000000000002', 'packages', 'inv.packages', '1.0', 'h3', now(), now() - interval '1 hour')$$,
  '23514', null, 'valid_to cannot precede valid_from');
select throws_ok(
  $$delete from public.computers where id = '20000000-0000-0000-0000-00000000000a'$$,
  '23503', null, 'a computer with history cannot be deleted');
select throws_ok(
  $$insert into public.installations (tenant_id, computer_id, title_id, domain, query_name, version, row_hash, valid_from)
    values ('99999999-0000-0000-0000-000000000000', '20000000-0000-0000-0000-00000000000a',
            '30000000-0000-0000-0000-000000000002', 'packages', 'inv.packages', '1.0', 'h4', now())$$,
  '23503', null, 'an installation cannot claim another tenant');

-- Classification order ---------------------------------------------------------------------------
insert into public.dictionary_cache (kind, source, match_key, canonical_name, category_slug, attention_level, confidence, method) values
  ('extension', 'chrome', 'inomeogfingihgjfjlpeplalcfajhgai', 'Chrome Remote Desktop',
   'remote-access/remote-desktop-and-support', 'review', 0.97, 'jev_auto'),
  ('program', 'programs', 'obs studio|obs project', 'OBS Studio', 'other/other', 'info', null, 'manual');

select results_eq(
  $$select origin, category_slug, level1_name, attention_level::text, confidence
    from public.title_classification where title_id = '30000000-0000-0000-0000-000000000001'$$,
  $$values ('hub', 'remote-access/remote-desktop-and-support', 'Remote access', 'review', 0.970::numeric(4,3))$$,
  'a dictionary match classifies the title');
select is(
  (select origin from public.title_classification where title_id = '30000000-0000-0000-0000-000000000002'),
  'unclassified', 'a title without a match is unclassified');

insert into public.local_overrides (title_id, category_slug) values
  ('30000000-0000-0000-0000-000000000003', 'general-business/screen-capture-and-recording');
select results_eq(
  $$select origin, category_slug, method from public.title_classification where title_id = '30000000-0000-0000-0000-000000000003'$$,
  $$values ('local_override', 'general-business/screen-capture-and-recording', null::text)$$,
  'a local override wins over the dictionary');

-- Title summary ----------------------------------------------------------------------------------
refresh materialized view public.title_summary;
select results_eq(
  $$select computers, latest_version, category_slug from public.title_summary
    where title_id = '30000000-0000-0000-0000-000000000001'$$,
  $$values (1::bigint, '1.0', 'remote-access/remote-desktop-and-support')$$,
  'title_summary counts open installations per tenant');
select is((select count(*) from public.title_summary where title_id = '30000000-0000-0000-0000-000000000002'), 0::bigint,
  'titles without open installations are not summarised');

select * from finish();
rollback;
