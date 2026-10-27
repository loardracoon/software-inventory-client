# Phase 3: query catalog and capability probe

From `docs/spec.md`, section "Prompts do cliente" ("Fase 3: catálogo de queries e teste de capacidade"). Plan first, implement, then verify with build and tests before the next phase.

Phase 3: query catalog and capability probe.

Seed query_catalog with version 1 of these packs (one row per domain and platform):
- windows: hardware (system_info + os_version + platform_info), disks (logical_drives), programs (programs), extensions (users JOIN chrome_extensions UNION ALL users JOIN firefox_addons), ide_extensions (users JOIN vscode_extensions), packages (chocolatey_packages UNION ALL npm_packages UNION ALL python_packages).
- macos: hardware, disks (mounts), programs (apps), extensions, ide_extensions, packages (homebrew_packages, npm_packages, python_packages).
- linux: hardware, disks (mounts), programs (deb_packages and rpm_packages as separate queries), extensions, ide_extensions, packages (npm_packages, python_packages).
Use the SQL from the design document. Fill required_tables for each query.

Edge Function probe-capabilities: for each tenant and platform, pick the most recently seen computer, run SELECT name FROM osquery_registry WHERE registry = 'table', and save the list in platform_capabilities. A query whose required_tables are not all present is skipped for that tenant and platform.
Settings > Queries: a read-only list with name, version, platforms and status (ok, missing tables), plus a "Probe again" button for admins.
