-- Phase 1: read-only copy of the Dictionary Hub, local overrides and the queue of unknown titles.
-- The Hub owns categories and the dictionary; this app never edits them (Phase 7 syncs them).
-- Clients map categories by slug ("slugs never change", docs/taxonomy.md); hub_id is filled on sync.

create table public.categories_cache (
  slug text primary key,
  hub_id uuid unique,
  parent_slug text references public.categories_cache (slug) on update cascade on delete restrict,
  level smallint generated always as (case when parent_slug is null then 1 else 2 end) stored,
  name text not null,
  description text,
  -- Default attention of a level-2 category; null on level 1.
  attention_level public.attention_level,
  sophos_firewall_category text,
  revision integer not null default 0,
  seq bigint not null default 0,
  deprecated boolean not null default false,
  synced_at timestamptz,
  check ((parent_slug is null) = (attention_level is null))
);

create index categories_cache_parent_idx on public.categories_cache (parent_slug);

-- Published dictionary entries. Classification: local override > exact match on
-- (kind, source, match_key) > unclassified.
create table public.dictionary_cache (
  kind public.title_kind not null,
  source text not null,
  match_key text not null,
  canonical_name text not null,
  vendor text,
  description text,
  category_slug text not null references public.categories_cache (slug) on update cascade on delete restrict,
  -- Attention as published by the Hub (entry override or the category default).
  attention_level public.attention_level not null,
  confidence numeric(4, 3) check (confidence between 0 and 1),
  method text not null check (method in ('rule', 'jev', 'jev_auto', 'manual')),
  revision integer not null default 1,
  status text not null default 'published' check (status in ('published', 'deprecated')),
  hub_seq bigint not null default 0,
  synced_at timestamptz not null default now(),
  primary key (kind, source, match_key)
);

create index dictionary_cache_category_idx on public.dictionary_cache (category_slug);

-- Decisions of this app's admins. They never leave this app.
create table public.local_overrides (
  title_id uuid primary key references public.software_titles (id) on delete cascade,
  category_slug text not null references public.categories_cache (slug) on update cascade on delete restrict,
  attention_level public.attention_level,
  note text check (char_length(note) <= 500),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index local_overrides_category_idx on public.local_overrides (category_slug);

-- Unknown titles waiting to be sent to the Hub. Metadata only: never hostnames, users, tenant
-- names or install counts.
create table public.hub_submissions (
  id uuid primary key default gen_random_uuid(),
  kind public.title_kind not null,
  source text not null,
  match_key text not null,
  name text not null,
  vendor text,
  description text check (char_length(description) <= 1000),
  first_seen timestamptz not null default now(),
  sent_at timestamptz,
  unique (kind, source, match_key)
);

create index hub_submissions_unsent_idx on public.hub_submissions (first_seen) where sent_at is null;

alter table public.categories_cache enable row level security;
alter table public.dictionary_cache enable row level security;
alter table public.local_overrides enable row level security;
alter table public.hub_submissions enable row level security;

create policy "Signed-in users read categories"
  on public.categories_cache for select
  to authenticated
  using (true);

create policy "Signed-in users read the dictionary"
  on public.dictionary_cache for select
  to authenticated
  using (true);

create policy "Signed-in users read local overrides"
  on public.local_overrides for select
  to authenticated
  using (true);

create policy "Admins create local overrides"
  on public.local_overrides for insert
  to authenticated
  with check ((select public.is_admin()));

create policy "Admins change local overrides"
  on public.local_overrides for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Admins remove local overrides"
  on public.local_overrides for delete
  to authenticated
  using ((select public.is_admin()));

create policy "Admins read hub submissions"
  on public.hub_submissions for select
  to authenticated
  using ((select public.is_admin()));

revoke all on table
  public.categories_cache, public.dictionary_cache, public.local_overrides, public.hub_submissions
  from anon, authenticated;
grant select on table
  public.categories_cache, public.dictionary_cache, public.local_overrides, public.hub_submissions
  to authenticated;
grant insert, update, delete on table public.local_overrides to authenticated;

-- Seed: the taxonomy in docs/taxonomy.csv (29 level-1, 71 level-2). Hub sync updates these rows by
-- slug. Generated from docs/taxonomy.json; regenerate rather than edit by hand.
insert into public.categories_cache (slug, parent_slug, name, description, attention_level, sophos_firewall_category) values
  ('remote-access', null, 'Remote access', null, null, 'Remote access'),
  ('proxy-and-tunnel', null, 'Proxy and tunnel', null, null, 'Proxy and tunnel'),
  ('file-transfer', null, 'File transfer', null, null, 'File transfer'),
  ('storage-and-backup', null, 'Storage and backup', null, null, 'Storage and backup'),
  ('p2p', null, 'P2P', null, null, 'P2P'),
  ('download-applications', null, 'Download applications', null, null, 'Download applications'),
  ('conferencing', null, 'Conferencing', null, null, 'Conferencing'),
  ('instant-messenger', null, 'Instant messenger', null, null, 'Instant messenger'),
  ('voip', null, 'VoIP', null, null, 'VoIP'),
  ('desktop-mail', null, 'Desktop mail', null, null, 'Desktop mail'),
  ('web-mail', null, 'Web mail', null, null, 'Web mail'),
  ('streaming-media', null, 'Streaming media', null, null, 'Streaming media'),
  ('social-networking', null, 'Social networking', null, null, 'Social networking'),
  ('gaming', null, 'Gaming', null, null, 'Gaming'),
  ('e-commerce', null, 'E-commerce', null, null, 'E-commerce'),
  ('generative-ai', null, 'Generative AI', null, null, 'Generative AI'),
  ('general-business', null, 'General business', null, null, 'General business'),
  ('general-internet', null, 'General internet', null, null, 'General internet'),
  ('software-update', null, 'Software update', null, null, 'Software update'),
  ('infrastructure', null, 'Infrastructure', null, null, 'Infrastructure'),
  ('network-services', null, 'Network services', null, null, 'Network services'),
  ('industrial-control-system', null, 'Industrial control system', null, null, 'Industrial control system'),
  ('mobile-applications', null, 'Mobile applications', null, null, 'Mobile applications'),
  ('system-applications', null, 'System applications', null, null, 'System applications'),
  ('sophos-applications', null, 'Sophos applications', null, null, 'Sophos applications'),
  ('security-and-identity', null, 'Security and identity', null, null, null),
  ('developer-tools', null, 'Developer tools', null, null, null),
  ('unwanted-software', null, 'Unwanted software', null, null, null),
  ('other', null, 'Other', null, null, null),
  ('remote-access/remote-desktop-and-support', 'remote-access', 'Remote desktop and support', 'Tools that let someone see and control this computer or another one over the network, attended or unattended.', 'review', 'Remote access'),
  ('remote-access/remote-management-agents-rmm', 'remote-access', 'Remote management agents (RMM)', 'Agents of IT management platforms that run scripts, install software and open remote sessions.', 'review', 'Remote access'),
  ('remote-access/vnc-and-rdp-servers', 'remote-access', 'VNC and RDP servers', 'Software that accepts incoming remote desktop connections on this computer.', 'review', 'Remote access'),
  ('remote-access/ssh-and-terminal-clients', 'remote-access', 'SSH and terminal clients', 'Clients used to open shells on other systems.', 'info', 'Remote access'),
  ('proxy-and-tunnel/corporate-vpn-clients', 'proxy-and-tunnel', 'Corporate VPN clients', 'VPN clients usually deployed by the organization to reach internal networks.', 'info', 'Proxy and tunnel'),
  ('proxy-and-tunnel/consumer-vpn-and-proxy-services', 'proxy-and-tunnel', 'Consumer VPN and proxy services', 'Personal VPN or proxy apps and browser extensions that route traffic through a third-party service.', 'review', 'Proxy and tunnel'),
  ('proxy-and-tunnel/tunnels-and-mesh-networks', 'proxy-and-tunnel', 'Tunnels and mesh networks', 'Tools that expose local services to the internet or join the computer to an overlay network.', 'review', 'Proxy and tunnel'),
  ('proxy-and-tunnel/anonymizers', 'proxy-and-tunnel', 'Anonymizers', 'Software built to hide the user''s identity or bypass network controls.', 'not_allowed', 'Proxy and tunnel'),
  ('file-transfer/ftp-and-sftp-clients', 'file-transfer', 'FTP and SFTP clients', 'Clients for moving files to and from servers.', 'info', 'File transfer'),
  ('file-transfer/direct-file-sharing', 'file-transfer', 'Direct file sharing', 'Apps that send files between devices or people outside managed storage.', 'review', 'File transfer'),
  ('storage-and-backup/cloud-storage-sync', 'storage-and-backup', 'Cloud storage sync', 'Desktop clients and extensions that sync files with a cloud drive.', 'info', 'Storage and backup'),
  ('storage-and-backup/backup-software', 'storage-and-backup', 'Backup software', 'Software that copies data to local or remote backup targets.', 'info', 'Storage and backup'),
  ('p2p/torrent-clients', 'p2p', 'Torrent clients', 'BitTorrent clients and torrent search tools.', 'not_allowed', 'P2P'),
  ('p2p/other-p2p-networks', 'p2p', 'Other P2P networks', 'File sharing over other peer-to-peer networks.', 'not_allowed', 'P2P'),
  ('download-applications/download-managers', 'download-applications', 'Download managers', 'Tools that accelerate or schedule downloads outside the browser.', 'review', 'Download applications'),
  ('download-applications/media-downloaders', 'download-applications', 'Media downloaders', 'Tools that save video or audio from streaming sites.', 'review', 'Download applications'),
  ('conferencing/video-meetings', 'conferencing', 'Video meetings', 'Meeting and webinar clients and their browser extensions.', 'info', 'Conferencing'),
  ('instant-messenger/team-chat', 'instant-messenger', 'Team chat', 'Workplace messaging platforms.', 'info', 'Instant messenger'),
  ('instant-messenger/consumer-messaging', 'instant-messenger', 'Consumer messaging', 'Personal messaging apps on a work computer.', 'review', 'Instant messenger'),
  ('voip/softphones', 'voip', 'Softphones', 'Telephony clients that place or receive calls over IP.', 'info', 'VoIP'),
  ('desktop-mail/mail-clients', 'desktop-mail', 'Mail clients', 'Desktop email clients and their add-ins.', 'info', 'Desktop mail'),
  ('web-mail/web-mail-helpers', 'web-mail', 'Web mail helpers', 'Browser extensions that add features to web mail.', 'info', 'Web mail'),
  ('streaming-media/video-streaming', 'streaming-media', 'Video streaming', 'Players and extensions for video streaming services, including DRM components.', 'info', 'Streaming media'),
  ('streaming-media/music-and-podcasts', 'streaming-media', 'Music and podcasts', 'Music and podcast streaming clients.', 'info', 'Streaming media'),
  ('streaming-media/media-players-and-casting', 'streaming-media', 'Media players and casting', 'Local media players and casting receivers.', 'info', 'Streaming media'),
  ('social-networking/social-network-apps-and-extensions', 'social-networking', 'Social network apps and extensions', 'Apps and extensions for social networks.', 'info', 'Social networking'),
  ('gaming/game-launchers-and-stores', 'gaming', 'Game launchers and stores', 'Platforms that install and run games.', 'review', 'Gaming'),
  ('gaming/games', 'gaming', 'Games', 'Installed games and browser games.', 'review', 'Gaming'),
  ('e-commerce/shopping-assistants', 'e-commerce', 'Shopping assistants', 'Coupon, cashback, price tracking and wish list extensions; many read every page the user visits.', 'review', 'E-commerce'),
  ('generative-ai/ai-assistants', 'generative-ai', 'AI assistants', 'Chat assistants as desktop apps or browser extensions.', 'review', 'Generative AI'),
  ('generative-ai/ai-browser-extensions', 'generative-ai', 'AI browser extensions', 'Sidebars, writers and summarizers that read the content of the pages the user visits.', 'review', 'Generative AI'),
  ('generative-ai/ai-coding-assistants', 'generative-ai', 'AI coding assistants', 'Code completion and coding agents inside IDEs and terminals.', 'review', 'Generative AI'),
  ('generative-ai/local-ai-runtimes', 'generative-ai', 'Local AI runtimes', 'Tools that download and run models on the computer.', 'review', 'Generative AI'),
  ('general-business/office-and-documents', 'general-business', 'Office and documents', 'Office suites, PDF tools and document viewers.', 'info', 'General business'),
  ('general-business/notes-and-knowledge', 'general-business', 'Notes and knowledge', 'Note taking, wikis and knowledge tools.', 'info', 'General business'),
  ('general-business/design-and-creative', 'general-business', 'Design and creative', 'Graphics, video editing and design tools.', 'info', 'General business'),
  ('general-business/screen-capture-and-recording', 'general-business', 'Screen capture and recording', 'Tools that record or capture the screen.', 'review', 'General business'),
  ('general-business/business-applications', 'general-business', 'Business applications', 'ERP, CRM, accounting and other line-of-business clients.', 'info', 'General business'),
  ('general-business/compression-and-file-utilities', 'general-business', 'Compression and file utilities', 'Archive and file management utilities.', 'info', 'General business'),
  ('general-internet/web-browsers', 'general-internet', 'Web browsers', 'Web browsers and their release channels.', 'info', 'General internet'),
  ('general-internet/browser-utilities', 'general-internet', 'Browser utilities', 'New tab pages, translators, ad blockers and other extensions that change pages.', 'info', 'General internet'),
  ('general-internet/learning', 'general-internet', 'Learning', 'Education and language learning apps.', 'info', 'General internet'),
  ('general-internet/legacy-chrome-apps', 'general-internet', 'Legacy Chrome apps', 'Deprecated Chrome apps kept from old browser profiles.', 'review', 'General internet'),
  ('software-update/updaters', 'software-update', 'Updaters', 'Background services that update other software.', 'info', 'Software update'),
  ('infrastructure/virtualization-and-containers', 'infrastructure', 'Virtualization and containers', 'Hypervisors, containers and Linux subsystems that run isolated environments.', 'review', 'Infrastructure'),
  ('infrastructure/admin-tools', 'infrastructure', 'Admin tools', 'Tools used to administer systems and inspect networks.', 'info', 'Infrastructure'),
  ('network-services/web-and-app-servers', 'network-services', 'Web and app servers', 'Web servers and application runtimes that accept connections.', 'review', 'Network services'),
  ('network-services/mail-servers', 'network-services', 'Mail servers', 'Software that sends or receives mail for other users or systems.', 'review', 'Network services'),
  ('network-services/database-servers', 'network-services', 'Database servers', 'Database engines running on the computer.', 'review', 'Network services'),
  ('network-services/local-development-stacks', 'network-services', 'Local development stacks', 'Bundled web stacks for local development.', 'review', 'Network services'),
  ('industrial-control-system/ics-engineering-and-hmi-software', 'industrial-control-system', 'ICS engineering and HMI software', 'Software that programs or monitors PLCs and industrial equipment.', 'review', 'Industrial control system'),
  ('mobile-applications/phone-companions', 'mobile-applications', 'Phone companions', 'Apps that connect phones to the computer.', 'info', 'Mobile applications'),
  ('system-applications/os-components-and-runtimes', 'system-applications', 'OS components and runtimes', 'Operating system features, redistributables and runtimes installed as dependencies.', 'info', 'System applications'),
  ('system-applications/drivers-and-hardware-utilities', 'system-applications', 'Drivers and hardware utilities', 'Drivers and vendor utilities for devices.', 'info', 'System applications'),
  ('system-applications/oem-utilities', 'system-applications', 'OEM utilities', 'Manufacturer tools preinstalled on the computer.', 'info', 'System applications'),
  ('system-applications/browser-components', 'system-applications', 'Browser components', 'Components that ship with the browser or its store.', 'info', 'System applications'),
  ('sophos-applications/sophos-agents-and-tools', 'sophos-applications', 'Sophos agents and tools', 'Sophos endpoint, ZTNA, VPN and management software.', 'info', 'Sophos applications'),
  ('security-and-identity/antivirus-and-edr-third-party', 'security-and-identity', 'Antivirus and EDR (third party)', 'Security agents from other vendors; they may conflict with the Sophos agent.', 'review', null),
  ('security-and-identity/password-managers', 'security-and-identity', 'Password managers', 'Vaults that store credentials, as apps or browser extensions.', 'info', null),
  ('security-and-identity/authenticators-and-mfa', 'security-and-identity', 'Authenticators and MFA', 'One-time password and passkey tools.', 'info', null),
  ('security-and-identity/encryption-tools', 'security-and-identity', 'Encryption tools', 'Disk, file or container encryption outside managed policy.', 'review', null),
  ('security-and-identity/security-testing-tools', 'security-and-identity', 'Security testing tools', 'Scanners, sniffers and offensive tools; legitimate for security teams and common in attacks.', 'review', null),
  ('developer-tools/ides-and-editors', 'developer-tools', 'IDEs and editors', 'Code editors and integrated development environments.', 'info', null),
  ('developer-tools/language-runtimes-and-sdks', 'developer-tools', 'Language runtimes and SDKs', 'Compilers, interpreters and SDKs.', 'info', null),
  ('developer-tools/clis-and-version-control', 'developer-tools', 'CLIs and version control', 'Command-line tools, source control and cloud CLIs.', 'info', null),
  ('developer-tools/libraries-and-packages', 'developer-tools', 'Libraries and packages', 'Packages installed by npm, pip, Homebrew or Chocolatey that are libraries rather than apps.', 'info', null),
  ('developer-tools/ide-extensions', 'developer-tools', 'IDE extensions', 'Extensions for code editors that are not AI assistants.', 'info', null),
  ('unwanted-software/adware-and-browser-hijackers', 'unwanted-software', 'Adware and browser hijackers', 'Software that injects ads, changes the search engine or tracks browsing without clear consent.', 'not_allowed', null),
  ('unwanted-software/cracks-and-license-bypass', 'unwanted-software', 'Cracks and license bypass', 'Keygens, activators and patched installers.', 'not_allowed', null),
  ('unwanted-software/crypto-miners', 'unwanted-software', 'Crypto miners', 'Software that mines cryptocurrency on the computer.', 'not_allowed', null),
  ('other/other', 'other', 'Other', 'Software that fits no other category; use only when nothing else applies.', 'info', null);
