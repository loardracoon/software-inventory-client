-- Phase 10a: product grouping. The Hub's name and vendor vectors (keep both lists equal), the product key
-- from the Hub, the classification fallback, and Software / title versions grouped by product.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
truncate public.tenants, public.software_titles, public.audit_log, public.dictionary_cache, public.hub_submissions cascade;
delete from public.profiles;

select plan(34);

-- The same vectors as hub/supabase/tests/database/products.test.sql ---------------------------------------
select is(public.product_name(n), expected, format('product_name(%s)', n))
from (values
  ('7-Zip 23.01 (x64)', '7-Zip'),
  ('7-Zip 26.05 (x64)', '7-Zip'),
  ('Notepad++ 8.6.4 (64-bit x64)', 'Notepad++'),
  ('Notepad++ (64-bit x64)', 'Notepad++'),
  ('Python 3.12.1 (64-bit)', 'Python'),
  ('Microsoft Visual C++ 2015-2022 Redistributable (x64) - 14.38.33135', 'Microsoft Visual C++ 2015-2022 Redistributable'),
  ('Mozilla Firefox (x64 en-US)', 'Mozilla Firefox (x64 en-US)'),
  ('VLC media player v3.0.20', 'VLC media player'),
  ('Java 8 Update 401', 'Java 8 Update 401'),
  ('python3.12', 'python3.12'),
  ('7-Zip', '7-Zip'),
  ('1.2.3', '1.2.3'),
  ('WindowsAppRuntime.1.8', 'WindowsAppRuntime'),
  ('WindowsAppRuntime.2', 'WindowsAppRuntime'),
  ('Microsoft.UI.Xaml.2.8', 'Microsoft.UI.Xaml'),
  ('Microsoft.WindowsAppRuntime.CBS.1.6', 'Microsoft.WindowsAppRuntime.CBS'),
  ('WinAppRuntime.Main.1.8', 'WinAppRuntime.Main'),
  ('Microsoft .Net Native Framework Package 2.2', 'Microsoft .Net Native Framework Package'),
  ('Sophos Data Protection Agent 2.11.48.0', 'Sophos Data Protection Agent'),
  ('Node.js', 'Node.js')
) as v (n, expected);

select is(public.vendor_key(v), expected, format('vendor_key(%s)', v))
from (values
  ('Microsoft Corporation', 'microsoft'),
  ('Microsoft Corp.', 'microsoft'),
  ('Sophos Limited', 'sophos'),
  ('AnyDesk Software GmbH', 'anydesk software'),
  ('Zoom Video Communications, Inc.', 'zoom video communications'),
  ('Igor Pavlov', 'igor pavlov'),
  (null, '')
) as v (v, expected);

-- Fixtures: two spellings of 7-Zip (programs v1 and v2) on two computers ---------------------------------
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'admin@example.com');
insert into public.tenants (id, sophos_tenant_id, name, id_type) values ('10000000-0000-0000-0000-00000000000a', 'sophos-a', 'Tenant A', 'tenant');
insert into public.computers (id, tenant_id, sophos_endpoint_id, hostname, platform) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'ep-1', 'PC1', 'windows'),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'ep-2', 'PC2', 'windows');
insert into public.software_titles (id, kind, source, match_key, canonical_name, vendor) values
  ('30000000-0000-0000-0000-000000000001', 'program', 'programs', '7-zip 26.05 (x64)|igor pavlov', '7-Zip 26.05 (x64)', 'Igor Pavlov'),
  ('30000000-0000-0000-0000-000000000002', 'program', 'programs', '7-zip|igor pavlov', '7-Zip', 'Igor Pavlov');
insert into public.installations (tenant_id, computer_id, title_id, domain, query_name, scope_key, version, row_hash, valid_from) values
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000001', 'programs', 'inv.programs', '', '26.05', 'h1', now()),
  ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', '30000000-0000-0000-0000-000000000002', 'programs', 'inv.programs', '', '23.01', 'h2', now());
update public.categories_cache set hub_id = 'c1000000-0000-0000-0000-0000000000c1' where slug = 'general-business/compression-and-file-utilities';

select is(public.apply_dictionary_changes('[]',
  '[{"kind": "program", "source": "programs", "match_key": "7-zip 26.05 (x64)|igor pavlov", "canonical_name": "7-Zip 26.05 (x64)", "vendor": "Igor Pavlov",
     "category_id": "c1000000-0000-0000-0000-0000000000c1", "method": "manual", "revision": 2, "status": "published", "seq": 9,
     "product_id": "d1000000-0000-0000-0000-000000000001", "product_key": "program|igor pavlov|7-zip"}]', 9) ->> 'upserted', '1',
  'a dictionary entry with product fields is accepted');
select is((select product_key from public.dictionary_cache where match_key = '7-zip 26.05 (x64)|igor pavlov'), 'program|igor pavlov|7-zip',
  'the Hub product key is kept');
select is((select count(distinct product_key)::int from public.title_products
  where title_id in ('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002')), 1, 'both spellings are one product');
select results_eq($$select category_slug, origin from public.title_classification where title_id = '30000000-0000-0000-0000-000000000002'$$,
  $$values ('general-business/compression-and-file-utilities', 'hub')$$, 'the new spelling takes the classification of its product');
select is(cardinality(public.title_group_ids('30000000-0000-0000-0000-000000000002')), 2, 'title_group_ids returns every spelling');

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000000a', 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq($$select canonical_name, spellings::int, computers::int, versions::int, latest_version from public.search_titles(p_query := '7-zip')$$,
  $$values ('7-Zip', 2, 2, 2, '26.05')$$, 'Software shows one row per product with every version');
select results_eq($$select version from public.title_versions('30000000-0000-0000-0000-000000000002')$$, $$values ('26.05'), ('23.01')$$,
  'the title page lists the versions of every spelling');
reset role;

select * from finish();
rollback;
