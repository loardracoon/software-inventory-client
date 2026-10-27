-- Phase 3: version 1 of the osquery packs, one row per domain and platform (Linux programs has a deb
-- and an rpm query). Queries change only by migration: a new shape gets a new version, which starts
-- a new baseline without change events (Phase 5). SQL from docs/spec.md › "Coleta com osquery";
-- macOS and Linux variants keep the Windows column names so normalization is shared.
-- Column availability (e.g. chrome_extensions.browser_type) depends on the agent's osquery version
-- and is part of the lab checks; the capability probe only checks tables.

insert into public.query_catalog (domain, platform, version, name, required_tables, sql) values

-- Windows -----------------------------------------------------------------------------------------
('hardware', 'windows', 1, 'inv.hardware', '{system_info,os_version,platform_info}', $q$
SELECT s.uuid AS hardware_uuid, s.hostname, s.hardware_vendor, s.hardware_model, s.hardware_serial,
       s.cpu_brand, s.cpu_physical_cores, s.cpu_logical_cores, s.physical_memory,
       o.name AS os_name, o.version AS os_version, o.build AS os_build, o.arch,
       p.vendor AS bios_vendor, p.version AS bios_version, p.date AS bios_date
FROM system_info s CROSS JOIN os_version o CROSS JOIN platform_info p;
$q$),
('disks', 'windows', 1, 'inv.disks', '{logical_drives}', $q$
SELECT device_id, type, file_system, size, free_space, boot_partition FROM logical_drives;
$q$),
('programs', 'windows', 1, 'inv.programs', '{programs}', $q$
SELECT name, version, publisher, install_date, install_location, identifying_number FROM programs;
$q$),
('extensions', 'windows', 1, 'inv.extensions', '{users,chrome_extensions,firefox_addons}', $q$
SELECT u.username, 'chromium' AS family, e.browser_type, e.profile, e.name, e.identifier, e.version,
       e.update_url, e.permissions, e.path
FROM users u CROSS JOIN chrome_extensions e USING (uid)
UNION ALL
SELECT u.username, 'firefox', 'firefox', NULL, f.name, f.identifier, f.version,
       f.source_url, NULL, f.path
FROM users u CROSS JOIN firefox_addons f USING (uid);
$q$),
('ide_extensions', 'windows', 1, 'inv.ide_extensions', '{users,vscode_extensions}', $q$
SELECT u.username, v.name, v.publisher, v.version, v.path FROM users u CROSS JOIN vscode_extensions v USING (uid);
$q$),
('packages', 'windows', 1, 'inv.packages', '{chocolatey_packages,npm_packages,python_packages}', $q$
SELECT 'chocolatey' AS manager, name, version, author AS vendor, path FROM chocolatey_packages
UNION ALL SELECT 'npm', name, version, author, path FROM npm_packages
UNION ALL SELECT 'pip', name, version, author, path FROM python_packages;
$q$),

-- macOS -------------------------------------------------------------------------------------------
('hardware', 'macos', 1, 'inv.hardware', '{system_info,os_version,platform_info}', $q$
SELECT s.uuid AS hardware_uuid, s.hostname, s.hardware_vendor, s.hardware_model, s.hardware_serial,
       s.cpu_brand, s.cpu_physical_cores, s.cpu_logical_cores, s.physical_memory,
       o.name AS os_name, o.version AS os_version, o.build AS os_build, o.arch,
       p.vendor AS bios_vendor, p.version AS bios_version, p.date AS bios_date
FROM system_info s CROSS JOIN os_version o CROSS JOIN platform_info p;
$q$),
('disks', 'macos', 1, 'inv.disks', '{mounts}', $q$
SELECT device AS device_id, type, type AS file_system, blocks_size * blocks AS size,
       blocks_size * blocks_available AS free_space, path AS mount_point
FROM mounts WHERE device LIKE '/dev/%';
$q$),
('programs', 'macos', 1, 'inv.programs', '{apps}', $q$
SELECT name, bundle_short_version AS version, NULL AS publisher, NULL AS install_date,
       path AS install_location, bundle_identifier AS identifying_number
FROM apps;
$q$),
('extensions', 'macos', 1, 'inv.extensions', '{users,chrome_extensions,firefox_addons}', $q$
SELECT u.username, 'chromium' AS family, e.browser_type, e.profile, e.name, e.identifier, e.version,
       e.update_url, e.permissions, e.path
FROM users u CROSS JOIN chrome_extensions e USING (uid)
UNION ALL
SELECT u.username, 'firefox', 'firefox', NULL, f.name, f.identifier, f.version,
       f.source_url, NULL, f.path
FROM users u CROSS JOIN firefox_addons f USING (uid);
$q$),
('ide_extensions', 'macos', 1, 'inv.ide_extensions', '{users,vscode_extensions}', $q$
SELECT u.username, v.name, v.publisher, v.version, v.path FROM users u CROSS JOIN vscode_extensions v USING (uid);
$q$),
('packages', 'macos', 1, 'inv.packages', '{homebrew_packages,npm_packages,python_packages}', $q$
SELECT 'homebrew' AS manager, name, version, NULL AS vendor, path FROM homebrew_packages
UNION ALL SELECT 'npm', name, version, author, path FROM npm_packages
UNION ALL SELECT 'pip', name, version, author, path FROM python_packages;
$q$),

-- Linux -------------------------------------------------------------------------------------------
('hardware', 'linux', 1, 'inv.hardware', '{system_info,os_version,platform_info}', $q$
SELECT s.uuid AS hardware_uuid, s.hostname, s.hardware_vendor, s.hardware_model, s.hardware_serial,
       s.cpu_brand, s.cpu_physical_cores, s.cpu_logical_cores, s.physical_memory,
       o.name AS os_name, o.version AS os_version, o.build AS os_build, o.arch,
       p.vendor AS bios_vendor, p.version AS bios_version, p.date AS bios_date
FROM system_info s CROSS JOIN os_version o CROSS JOIN platform_info p;
$q$),
('disks', 'linux', 1, 'inv.disks', '{mounts}', $q$
SELECT device AS device_id, type, type AS file_system, blocks_size * blocks AS size,
       blocks_size * blocks_available AS free_space, path AS mount_point
FROM mounts WHERE device LIKE '/dev/%' AND type NOT IN ('squashfs', 'iso9660');
$q$),
('programs', 'linux', 1, 'inv.programs.deb', '{deb_packages}', $q$
SELECT name, version, maintainer AS publisher, NULL AS install_date, NULL AS install_location,
       arch AS identifying_number
FROM deb_packages WHERE status = 'install ok installed';
$q$),
('programs', 'linux', 1, 'inv.programs.rpm', '{rpm_packages}', $q$
SELECT name, version || '-' || release AS version, vendor AS publisher, install_time AS install_date,
       NULL AS install_location, arch AS identifying_number
FROM rpm_packages;
$q$),
('extensions', 'linux', 1, 'inv.extensions', '{users,chrome_extensions,firefox_addons}', $q$
SELECT u.username, 'chromium' AS family, e.browser_type, e.profile, e.name, e.identifier, e.version,
       e.update_url, e.permissions, e.path
FROM users u CROSS JOIN chrome_extensions e USING (uid)
UNION ALL
SELECT u.username, 'firefox', 'firefox', NULL, f.name, f.identifier, f.version,
       f.source_url, NULL, f.path
FROM users u CROSS JOIN firefox_addons f USING (uid);
$q$),
('ide_extensions', 'linux', 1, 'inv.ide_extensions', '{users,vscode_extensions}', $q$
SELECT u.username, v.name, v.publisher, v.version, v.path FROM users u CROSS JOIN vscode_extensions v USING (uid);
$q$),
('packages', 'linux', 1, 'inv.packages', '{npm_packages,python_packages}', $q$
SELECT 'npm' AS manager, name, version, author AS vendor, path FROM npm_packages
UNION ALL SELECT 'pip', name, version, author, path FROM python_packages;
$q$);

-- Trim the leading and trailing newlines left by the dollar quotes.
update public.query_catalog set sql = btrim(sql, E'\n ');
