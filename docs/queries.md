# Queries used by Endpoint Inventory

This document lists every query that Endpoint Inventory sends to the computers, and explains what each one
collects and what the app does with the result. Read it to know exactly what leaves your computers, or to reuse a
query in your own Live Discover or Live Endpoint Query demo.

- [How the queries run](#how-the-queries-run)
- [All queries at a glance](#all-queries-at-a-glance)
- [Inventory queries](#inventory-queries): hardware, disks, programs, extensions, IDE extensions, packages
- [Support queries](#support-queries): capability probe, online check
- [Versions](#versions)
- [What is collected and what is not](#what-is-collected-and-what-is-not)
- [Run a query by hand](#run-a-query-by-hand)
- [Add or change a query](#add-or-change-a-query)

## How the queries run

The queries are **osquery SQL** (a read-only SQL view of the operating system). Sophos Endpoint runs them on the
computer when Sophos Central sends them as a **Live Discover** query. The app never installs an agent of its own.

1. The **collector** (every 5 minutes) opens a weekly **cycle** for each tenant. The default is Monday at 10:00 in
   the time zone of the tenant. A retry runs every day at 11:00 for the computers that did not answer.
2. For each computer, the cycle makes **one task for each query of its platform** (the catalog below). Windows and
   macOS computers get 6 tasks, Linux computers get 7.
3. A task is **skipped** when the computer does not have a table that the query needs (the *capability probe*
   found it missing). The reason is shown in Settings › Queries.
4. The collector checks which computers are online, and sends the query only to those. One Live Discover **run** is
   **one query for a batch of up to 50 computers** (Scans › Schedule › *Computers per run*). It never sends the query to an offline computer.
5. The run uses the **Live Endpoint Search GraphQL API** (`createLiveDiscoverSession`, `endpointSessions`,
   `runLiveDiscoverQuery`). If it is not available, the app uses the older **Live Discover REST API**
   (`POST /live-discover/v1/queries/runs`). You choose it in Scans › Schedule › **Query provider**.
6. The collector reads the results in pages of 1,000 rows and gives them to the **normalizer**
   (`supabase/functions/_shared/normalize.ts`), which makes the inventory rows and the change history.

Limits that the collector keeps (the defaults for each tenant, editable by admins in Scans › Schedule): at most
**4 runs at the same time** (*Active runs at once*), **10 runs per minute** (*Runs per minute*), **1,000 runs per
day** (*Daily run limit*), with **20%** of them kept for retries and Scan now (*Daily reserve*). A run that does not
finish in **10 minutes** (*Cancel run after*) is cancelled, and its computers are tried again later.

The queries live in the database table `query_catalog` and **change only by migration**. Settings › Queries shows
them (read-only) with the number of tenants that can run each one.

## All queries at a glance

| Query name | Domain | Windows | macOS | Linux | Tables it needs | What it collects |
| --- | --- | :---: | :---: | :---: | --- | --- |
| `inv.hardware` | hardware | yes | yes | yes | `system_info`, `os_version`, `platform_info` | One row: model, serial number, CPU, memory, operating system, BIOS |
| `inv.disks` | disks | yes | yes | yes | `logical_drives` (Windows), `mounts` (macOS, Linux) | One row per disk or volume: type, size, free space |
| `inv.programs` | programs | yes (v2) | yes (v2) | no | `programs` (Windows), `apps` (macOS) | Installed programs |
| `inv.programs.deb` | programs | no | no | yes (v2) | `deb_packages` | Installed Debian and Ubuntu packages |
| `inv.programs.rpm` | programs | no | no | yes (v2) | `rpm_packages` | Installed Red Hat, Fedora and SUSE packages |
| `inv.extensions` | extensions | yes | yes | yes | `users`, `chrome_extensions`, `firefox_addons` | Browser extensions of every user |
| `inv.ide_extensions` | ide_extensions | yes | yes | yes | `users`, `vscode_extensions` | Visual Studio Code extensions of every user |
| `inv.packages` | packages | yes | yes | yes | Windows: `chocolatey_packages`, `npm_packages`, `python_packages`. macOS: `homebrew_packages`, `npm_packages`, `python_packages`. Linux: `npm_packages`, `python_packages` | Packages of Chocolatey, Homebrew, npm and pip |
| `inv.capability_probe` | support | yes | yes | yes | `osquery_registry` | The list of osquery tables that the computer has |

The catalog has **19 rows** (6 for Windows, 6 for macOS, 7 for Linux). Linux has two program queries because
Debian-based and Red Hat-based systems keep their packages in different tables. A Linux computer runs both, and the
probe makes the one without its table be skipped.

## Inventory queries

Each section gives the SQL exactly as it is in the catalog (`supabase/migrations/20261026220000_query_catalog_v1.sql`),
the meaning of the columns, and how the normalizer turns the rows into inventory. The macOS and Linux versions keep
the **same column names as Windows**, so one normalizer serves all platforms.

### `inv.hardware`

All three platforms use the same SQL. The query returns **one row** that joins three single-row tables.

```sql
SELECT s.uuid AS hardware_uuid, s.hostname, s.hardware_vendor, s.hardware_model, s.hardware_serial,
       s.cpu_brand, s.cpu_physical_cores, s.cpu_logical_cores, s.physical_memory,
       o.name AS os_name, o.version AS os_version, o.build AS os_build, o.arch,
       p.vendor AS bios_vendor, p.version AS bios_version, p.date AS bios_date
FROM system_info s CROSS JOIN os_version o CROSS JOIN platform_info p;
```

| Column | Meaning |
| --- | --- |
| `hardware_uuid`, `hostname` | Hardware identifier and computer name |
| `hardware_vendor`, `hardware_model`, `hardware_serial` | Manufacturer, model and serial number |
| `cpu_brand`, `cpu_physical_cores`, `cpu_logical_cores`, `physical_memory` | Processor and memory (bytes) |
| `os_name`, `os_version`, `os_build`, `arch` | Operating system and architecture |
| `bios_vendor`, `bios_version`, `bios_date` | Firmware (BIOS or UEFI) |

**In the app:** all columns are stored together as one hardware item per computer (Computer page › Hardware). A
change in any value is recorded in the history.

### `inv.disks`

**Windows** reads the logical drives:

```sql
SELECT device_id, type, file_system, size, free_space, boot_partition FROM logical_drives;
```

**macOS** reads the mounted volumes of real devices:

```sql
SELECT device AS device_id, type, type AS file_system, blocks_size * blocks AS size,
       blocks_size * blocks_available AS free_space, path AS mount_point
FROM mounts WHERE device LIKE '/dev/%';
```

**Linux** does the same and leaves out read-only images:

```sql
SELECT device AS device_id, type, type AS file_system, blocks_size * blocks AS size,
       blocks_size * blocks_available AS free_space, path AS mount_point
FROM mounts WHERE device LIKE '/dev/%' AND type NOT IN ('squashfs', 'iso9660');
```

**In the app:** one hardware item for each disk, identified by `device_id`. `free_space` is stored but **not
tracked**: it changes at every scan, so it never creates a change event. A change of type, file system, size or boot
partition does.

### `inv.programs`, `inv.programs.deb`, `inv.programs.rpm`

All three return the same columns: `name`, `version`, `publisher`, `install_date`, `install_location`,
`identifying_number`. The value of each column depends on the platform.

**Windows** (`inv.programs`) reads the *Programs and Features* list:

```sql
SELECT name, version, publisher, install_date, install_location, identifying_number FROM programs;
```

**macOS** (`inv.programs`) reads the application bundles. The bundle identifier is the identifier of the program;
a bundle has no publisher or install date in this table:

```sql
SELECT name, bundle_short_version AS version, NULL AS publisher, NULL AS install_date,
       path AS install_location, bundle_identifier AS identifying_number
FROM apps;
```

**Linux, Debian and Ubuntu** (`inv.programs.deb`) reads the packages that are fully installed. The identifier is the
CPU architecture of the package:

```sql
SELECT name, version, maintainer AS publisher, NULL AS install_date, NULL AS install_location,
       arch AS identifying_number
FROM deb_packages WHERE status = 'install ok installed';
```

**Linux, Red Hat, Fedora and SUSE** (`inv.programs.rpm`) joins the version and the release:

```sql
SELECT name, version || '-' || release AS version, vendor AS publisher, install_time AS install_date,
       NULL AS install_location, arch AS identifying_number
FROM rpm_packages;
```

**In the app:**
- The title is identified by `name` and `publisher` (in lower case). The source is `programs` (Windows), `apps`
  (macOS), `deb` or `rpm` (Linux).
- If one title appears more than once on a computer, the **highest version** is kept, and the number of duplicates
  is stored.
- From **version 2**, the name loses its version and architecture, so "7-Zip 23.01 (x64)" and "7-Zip 26.05 (x64)"
  are one product, "7-Zip" (see [Versions](#versions)).
- A change of version, publisher or install location is recorded in the history.

### `inv.extensions`

All three platforms use the same SQL. It joins the extension tables of Chromium browsers (Chrome, Edge, Brave,
Vivaldi, Opera) and of Firefox to the list of users:

```sql
SELECT u.username, 'chromium' AS family, e.browser_type, e.profile, e.name, e.identifier, e.version,
       e.update_url, e.permissions, e.path
FROM users u CROSS JOIN chrome_extensions e USING (uid)
UNION ALL
SELECT u.username, 'firefox', 'firefox', NULL, f.name, f.identifier, f.version,
       f.source_url, NULL, f.path
FROM users u CROSS JOIN firefox_addons f USING (uid);
```

| Column | Meaning |
| --- | --- |
| `username` | The operating system user that owns the browser profile |
| `family`, `browser_type` | `chromium` or `firefox`, and the browser (for example `chrome`, `edge`) |
| `profile` | The browser profile |
| `name`, `identifier`, `version` | Name, extension ID and version |
| `update_url` | Where the extension updates from (Firefox: the source URL) |
| `permissions` | The permissions that the extension asks for (Chromium only) |
| `path` | Folder of the extension on disk |

**In the app:**
- Rows without a path or without an ID are dropped. Rows with the same path are one row (the row that has a user
  name wins).
- One installation for each **browser, user, profile and extension ID**. When old folders of the same extension
  remain on disk, the highest version is current and the others are listed as `stale_folders`.
- The user name goes in its own field, and viewers do not see it.
- The title is the extension ID; the source is the browser. A change of version, permissions or update URL is
  recorded. The Computer page flags an update over plain HTTP and old folders on disk.

### `inv.ide_extensions`

All three platforms use the same SQL:

```sql
SELECT u.username, v.name, v.publisher, v.version, v.path FROM users u CROSS JOIN vscode_extensions v USING (uid);
```

**In the app:** one installation for each user and extension. The title is `publisher.name`, for example
`ms-python.python`, with the source `vscode`. The highest version is kept. A change of version is recorded.

### `inv.packages`

The query reads the packages that developers install with a package manager. The first column, `manager`, names the
manager. The sources are different for each platform.

**Windows:** Chocolatey, npm and pip.

```sql
SELECT 'chocolatey' AS manager, name, version, author AS vendor, path FROM chocolatey_packages
UNION ALL SELECT 'npm', name, version, author, path FROM npm_packages
UNION ALL SELECT 'pip', name, version, author, path FROM python_packages;
```

**macOS:** Homebrew, npm and pip.

```sql
SELECT 'homebrew' AS manager, name, version, NULL AS vendor, path FROM homebrew_packages
UNION ALL SELECT 'npm', name, version, author, path FROM npm_packages
UNION ALL SELECT 'pip', name, version, author, path FROM python_packages;
```

**Linux:** npm and pip. (Linux system packages are in `inv.programs.deb` and `inv.programs.rpm`.)

```sql
SELECT 'npm' AS manager, name, version, author AS vendor, path FROM npm_packages
UNION ALL SELECT 'pip', name, version, author, path FROM python_packages;
```

**In the app:** one installation for each **manager, name and path**, so the same package in two projects is two
installations. The highest version is kept. The title is the package name, with the manager as its source. A change
of version is recorded.

## Support queries

These queries do not collect inventory. They make the inventory queries safe and efficient.

### `inv.capability_probe`

```sql
SELECT name FROM osquery_registry WHERE registry = 'table'
```

It returns the **names of all the osquery tables** that the agent of a computer has. The *capability probe* runs it
**once for each tenant and platform**, on the most recently seen computer that is online (Settings › Queries ›
**Probe again**). The result tells which inventory queries a tenant can run. A query whose tables are missing is
**skipped** with the message "Skipped: missing osquery tables ...", and it does not use a run.

### Online check (not an osquery query)

Before it sends a run, the collector asks Sophos Central which computers are online. It uses this GraphQL query,
in batches of 100 computers:

```graphql
query Online($input: EndpointSessionsFilter!) {
  liveDiscoverEndpointSearch(input: $input) { items { id online } pages { nextKey } }
}
```

The `online` field of this query is reliable. The `online` field of the Endpoint API is disabled in production.
Computers that are offline are checked again later the same day, and no run is spent on them.

### Computer list (not an osquery query)

The list of computers (name, operating system, health, last seen) comes from the **Endpoint API**
(`GET /endpoint/v1/endpoints`), not from a query. The sync runs when a tenant was not synced for 20 hours, and before its cycle opens.

## Versions

A query has a **version** (`query_catalog.version`). Rules:

- A query **never changes after it is released**. A new shape, or a new meaning of the result, gets a new
  version.
- A cycle uses the **latest version** of each query. Settings › Queries shows only that version.
- When a computer returns its **first result of a new version**, the app makes a new **baseline** and records **no
  change events**. So a new version never creates false changes.

| Query | Version | What changed |
| --- | --- | --- |
| All 19 | 1 | First release (Phase 3) |
| `inv.programs`, `inv.programs.deb`, `inv.programs.rpm` | 2 | **The SQL is the same as version 1.** The version tells the normalizer to remove the version number and the architecture from the program name, so one product is one title. Version 1 results keep their old keys, so their stored hashes never change |

## What is collected and what is not

**Collected:** names, versions, publishers and install locations of software; extension IDs, update URLs and
permissions; the names of the operating system users that own browser profiles and editor extensions; hardware
model, **serial number**, hardware UUID, CPU, memory, BIOS and disk sizes.

**Not collected:** file contents, documents, browsing history, passwords, cookies, running processes, network
connections, logged-in sessions, event logs or any user data outside the tables above. The queries only **read**.

**Access in the console:** the user names are hidden from the viewer role.

**What goes to the Dictionary Hub** (only when sharing is on): the metadata of titles that the Hub does not know
yet (kind, source, match key, name, vendor, description) and the operating system families where each title is
installed. **Never** the host names, user names, serial numbers, installed versions or counts. See the
[README](../README.md#connect-to-a-dictionary-hub).

## Run a query by hand

You can paste any of the SQL blocks above in **Sophos Central › Threat Analysis Center › Live Discover** (choose a
computer that is online, and paste the SQL in a new query) to see the result before the app collects it. This is
the best way to test a query for a demo of Live Endpoint Query. The column names of the result are the ones in the
tables of this document.

Some columns depend on the version of osquery in the Sophos agent. If a column is missing on an old agent, the
query fails on that computer, and the task shows the error in Scans.

## Add or change a query

Queries change only by migration (`supabase/migrations`). The steps, and the tests that protect them, are in
[docs/operations.md › Add a query version](operations.md#add-a-query-version). The test `src/test/queries-doc.test.ts`
checks that every SQL in this document is the same as the SQL in the catalog, so change both together.

Back to the [README](../README.md).
