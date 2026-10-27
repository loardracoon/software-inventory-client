# Application taxonomy

Two levels: 29 level-1 categories and 71 level-2 subcategories. 25 level-1 names match the Sophos Firewall application categories, so the inventory speaks the language of firewall policy; Security and identity, Developer tools, Unwanted software and Other exist only in the hub.

The machine-readable source is `taxonomy.csv` (same data in `taxonomy.json`). This file is the readable version of it.

## Rules

- **Entries point to level 2.** A dictionary entry always has a level-2 `category_id`; level 1 comes from `parent_id`.
- **Slugs never change.** Clients map by slug, so renaming a category republishes it under the same slug.
- **Default attention** is Info, Review or Not allowed, set per level-2 category. An entry can override it (`attention_override`); a client can override it locally. Only Info categories can be auto-published by Jev.
- **Jev options** are written as "Level 1 / Level 2: description" with the English descriptions below. If accuracy drops with 71 options, classify in two steps: level 1 first (29 options), then level 2 within it.
- **Left out on purpose:** the Sophos Firewall "SyncAppCtl discovered" bucket, because it is a discovery label, not an application type.
- **Real-data check:** all 23 extensions in the LAB-PC01 export fit the taxonomy. For example, Player do NOW NET Claro is Streaming media / Video streaming, and Chrome Media Router is System applications / Browser components.

## Legacy flat names

The design document and early mock used a flat list. Map it like this:

| Old flat category | New category |
| --- | --- |
| Remote access | Remote access / Remote desktop and support |
| VPN / proxy | Proxy and tunnel, in the subcategory that fits (Corporate VPN clients, Consumer VPN and proxy services, Tunnels and mesh networks, Anonymizers) |
| Screen capture | General business / Screen capture and recording |
| Password manager | Security and identity / Password managers |
| Legacy Chrome app | General internet / Legacy Chrome apps |
| Browser | General internet / Web browsers |
| Collaboration | Conferencing / Video meetings or Instant messenger / Team chat |
| Productivity | General business, in the subcategory that fits |
| Developer tooling | Developer tools, in the subcategory that fits |
| Web / app server, Mail server, Database server | Network services / Web and app servers, Mail servers, Database servers |
| Security | Security and identity, in the subcategory that fits |
| System component | System applications, in the subcategory that fits |
| Media | Streaming media, in the subcategory that fits |
| Shopping | E-commerce / Shopping assistants |
| Education | General internet / Learning |
| Other | Other / Other |

## Categories

### Remote access

Sophos Firewall category: Remote access

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| Remote desktop and support | `remote-access/remote-desktop-and-support` | Review | Tools that let someone see and control this computer or another one over the network, attended or unattended. | AnyDesk, TeamViewer, RustDesk, Chrome Remote Desktop, Splashtop, Parsec |
| Remote management agents (RMM) | `remote-access/remote-management-agents-rmm` | Review | Agents of IT management platforms that run scripts, install software and open remote sessions. | NinjaOne, Datto RMM, Atera, ConnectWise Automate |
| VNC and RDP servers | `remote-access/vnc-and-rdp-servers` | Review | Software that accepts incoming remote desktop connections on this computer. | RealVNC Server, TightVNC, UltraVNC, RDP Wrapper |
| SSH and terminal clients | `remote-access/ssh-and-terminal-clients` | Info | Clients used to open shells on other systems. | PuTTY, MobaXterm, Termius, Windows Terminal |

### Proxy and tunnel

Sophos Firewall category: Proxy and tunnel

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| Corporate VPN clients | `proxy-and-tunnel/corporate-vpn-clients` | Info | VPN clients usually deployed by the organization to reach internal networks. | FortiClient VPN, Cisco Secure Client, GlobalProtect, OpenVPN Connect |
| Consumer VPN and proxy services | `proxy-and-tunnel/consumer-vpn-and-proxy-services` | Review | Personal VPN or proxy apps and browser extensions that route traffic through a third-party service. | Urban VPN Proxy, Hola VPN, Hotspot Shield, NordVPN, Proton VPN |
| Tunnels and mesh networks | `proxy-and-tunnel/tunnels-and-mesh-networks` | Review | Tools that expose local services to the internet or join the computer to an overlay network. | ngrok, cloudflared, Tailscale, ZeroTier, frp |
| Anonymizers | `proxy-and-tunnel/anonymizers` | Not allowed | Software built to hide the user's identity or bypass network controls. | Tor Browser, Psiphon, Ultrasurf |

### File transfer

Sophos Firewall category: File transfer

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| FTP and SFTP clients | `file-transfer/ftp-and-sftp-clients` | Info | Clients for moving files to and from servers. | FileZilla, WinSCP, Cyberduck |
| Direct file sharing | `file-transfer/direct-file-sharing` | Review | Apps that send files between devices or people outside managed storage. | LocalSend, Send Anywhere, WeTransfer |

### Storage and backup

Sophos Firewall category: Storage and backup

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| Cloud storage sync | `storage-and-backup/cloud-storage-sync` | Info | Desktop clients and extensions that sync files with a cloud drive. | OneDrive, Google Drive, Dropbox, Box, Application Launcher For Drive |
| Backup software | `storage-and-backup/backup-software` | Info | Software that copies data to local or remote backup targets. | Veeam Agent, Acronis Cyber Protect, Backblaze, Macrium Reflect |

### P2P

Sophos Firewall category: P2P

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| Torrent clients | `p2p/torrent-clients` | Not allowed | BitTorrent clients and torrent search tools. | qBittorrent, µTorrent, BitTorrent, Transmission |
| Other P2P networks | `p2p/other-p2p-networks` | Not allowed | File sharing over other peer-to-peer networks. | eMule, Soulseek, Shareaza |

### Download applications

Sophos Firewall category: Download applications

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| Download managers | `download-applications/download-managers` | Review | Tools that accelerate or schedule downloads outside the browser. | Internet Download Manager, JDownloader, Free Download Manager |
| Media downloaders | `download-applications/media-downloaders` | Review | Tools that save video or audio from streaming sites. | yt-dlp, 4K Video Downloader, Video DownloadHelper |

### Conferencing

Sophos Firewall category: Conferencing

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| Video meetings | `conferencing/video-meetings` | Info | Meeting and webinar clients and their browser extensions. | Zoom Workplace, Microsoft Teams, Cisco Webex, Cisco Webex Extension |

### Instant messenger

Sophos Firewall category: Instant messenger

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| Team chat | `instant-messenger/team-chat` | Info | Workplace messaging platforms. | Slack, Mattermost, Rocket.Chat |
| Consumer messaging | `instant-messenger/consumer-messaging` | Review | Personal messaging apps on a work computer. | WhatsApp, Telegram, Signal, Discord |

### VoIP

Sophos Firewall category: VoIP

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| Softphones | `voip/softphones` | Info | Telephony clients that place or receive calls over IP. | 3CX, Zoiper, MicroSIP |

### Desktop mail

Sophos Firewall category: Desktop mail

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| Mail clients | `desktop-mail/mail-clients` | Info | Desktop email clients and their add-ins. | Outlook, Thunderbird, eM Client, Mailbird |

### Web mail

Sophos Firewall category: Web mail

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| Web mail helpers | `web-mail/web-mail-helpers` | Info | Browser extensions that add features to web mail. | Boomerang for Gmail, Mailtrack |

### Streaming media

Sophos Firewall category: Streaming media

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| Video streaming | `streaming-media/video-streaming` | Info | Players and extensions for video streaming services, including DRM components. | Netflix, Player do NOW NET Claro, Disney+ |
| Music and podcasts | `streaming-media/music-and-podcasts` | Info | Music and podcast streaming clients. | Spotify, Deezer, Apple Music |
| Media players and casting | `streaming-media/media-players-and-casting` | Info | Local media players and casting receivers. | VLC, PotPlayer, AllCast Receiver |

### Social networking

Sophos Firewall category: Social networking

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| Social network apps and extensions | `social-networking/social-network-apps-and-extensions` | Info | Apps and extensions for social networks. | Facebook, Instagram, LinkedIn, X |

### Gaming

Sophos Firewall category: Gaming

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| Game launchers and stores | `gaming/game-launchers-and-stores` | Review | Platforms that install and run games. | Steam, Epic Games Launcher, Battle.net, EA app |
| Games | `gaming/games` | Review | Installed games and browser games. | Minecraft, Roblox, League of Legends |

### E-commerce

Sophos Firewall category: E-commerce

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| Shopping assistants | `e-commerce/shopping-assistants` | Review | Coupon, cashback, price tracking and wish list extensions; many read every page the user visits. | Add to Amazon Wish List, Honey, Keepa |

### Generative AI

Sophos Firewall category: Generative AI

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| AI assistants | `generative-ai/ai-assistants` | Review | Chat assistants as desktop apps or browser extensions. | ChatGPT, Claude, Microsoft Copilot, Gemini |
| AI browser extensions | `generative-ai/ai-browser-extensions` | Review | Sidebars, writers and summarizers that read the content of the pages the user visits. | Monica, Merlin, Sider |
| AI coding assistants | `generative-ai/ai-coding-assistants` | Review | Code completion and coding agents inside IDEs and terminals. | GitHub Copilot, Cursor, Codeium |
| Local AI runtimes | `generative-ai/local-ai-runtimes` | Review | Tools that download and run models on the computer. | Ollama, LM Studio, GPT4All |

### General business

Sophos Firewall category: General business

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| Office and documents | `general-business/office-and-documents` | Info | Office suites, PDF tools and document viewers. | Microsoft 365 Apps, Adobe Acrobat, LibreOffice, Google Docs Offline |
| Notes and knowledge | `general-business/notes-and-knowledge` | Info | Note taking, wikis and knowledge tools. | Notion, Evernote Web Clipper, OneNote, Obsidian |
| Design and creative | `general-business/design-and-creative` | Info | Graphics, video editing and design tools. | Adobe Creative Cloud, Figma, Canva, DaVinci Resolve |
| Screen capture and recording | `general-business/screen-capture-and-recording` | Review | Tools that record or capture the screen. | Awesome Screen Recorder & Screenshot, OBS Studio, ShareX, Loom, Snagit |
| Business applications | `general-business/business-applications` | Info | ERP, CRM, accounting and other line-of-business clients. | SAP GUI, TOTVS, Salesforce, Power BI Desktop |
| Compression and file utilities | `general-business/compression-and-file-utilities` | Info | Archive and file management utilities. | 7-Zip, WinRAR, Everything |

### General internet

Sophos Firewall category: General internet

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| Web browsers | `general-internet/web-browsers` | Info | Web browsers and their release channels. | Google Chrome, Microsoft Edge, Firefox, Brave, Opera |
| Browser utilities | `general-internet/browser-utilities` | Info | New tab pages, translators, ad blockers and other extensions that change pages. | Momentum, uBlock Origin, Google Translate, Dark Reader |
| Learning | `general-internet/learning` | Info | Education and language learning apps. | Duolingo on the Web, Coursera, Khan Academy |
| Legacy Chrome apps | `general-internet/legacy-chrome-apps` | Review | Deprecated Chrome apps kept from old browser profiles. | Docs, Sheets, Slides, Gmail, YouTube, Google Drive (legacy apps) |

### Software update

Sophos Firewall category: Software update

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| Updaters | `software-update/updaters` | Info | Background services that update other software. | Google Update, Microsoft Edge Update, Adobe Updater, Java Update Scheduler |

### Infrastructure

Sophos Firewall category: Infrastructure

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| Virtualization and containers | `infrastructure/virtualization-and-containers` | Review | Hypervisors, containers and Linux subsystems that run isolated environments. | VirtualBox, VMware Workstation, Docker Desktop, WSL |
| Admin tools | `infrastructure/admin-tools` | Info | Tools used to administer systems and inspect networks. | Wireshark, RSAT, Sysinternals, mRemoteNG |

### Network services

Sophos Firewall category: Network services

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| Web and app servers | `network-services/web-and-app-servers` | Review | Web servers and application runtimes that accept connections. | IIS, Apache httpd, nginx, Tomcat, php-fpm |
| Mail servers | `network-services/mail-servers` | Review | Software that sends or receives mail for other users or systems. | Exchange Server, hMailServer, Postfix, Exim, Dovecot |
| Database servers | `network-services/database-servers` | Review | Database engines running on the computer. | SQL Server, MySQL, PostgreSQL, MongoDB, Redis |
| Local development stacks | `network-services/local-development-stacks` | Review | Bundled web stacks for local development. | XAMPP, WampServer, Laragon, MAMP |

### Industrial control system

Sophos Firewall category: Industrial control system

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| ICS engineering and HMI software | `industrial-control-system/ics-engineering-and-hmi-software` | Review | Software that programs or monitors PLCs and industrial equipment. | Siemens TIA Portal, Rockwell Studio 5000, Schneider EcoStruxure |

### Mobile applications

Sophos Firewall category: Mobile applications

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| Phone companions | `mobile-applications/phone-companions` | Info | Apps that connect phones to the computer. | Phone Link, iTunes, Android File Transfer, Samsung Smart Switch |

### System applications

Sophos Firewall category: System applications

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| OS components and runtimes | `system-applications/os-components-and-runtimes` | Info | Operating system features, redistributables and runtimes installed as dependencies. | Microsoft Visual C++ Redistributable, .NET Runtime, Java Runtime, WebView2 |
| Drivers and hardware utilities | `system-applications/drivers-and-hardware-utilities` | Info | Drivers and vendor utilities for devices. | Realtek Audio, Intel Graphics, Logi Options+, NVIDIA App |
| OEM utilities | `system-applications/oem-utilities` | Info | Manufacturer tools preinstalled on the computer. | Dell Command Update, HP Support Assistant, Lenovo Vantage |
| Browser components | `system-applications/browser-components` | Info | Components that ship with the browser or its store. | Chrome Web Store Payments, Chrome Media Router, Edge relevant text changes |

### Sophos applications

Sophos Firewall category: Sophos applications

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| Sophos agents and tools | `sophos-applications/sophos-agents-and-tools` | Info | Sophos endpoint, ZTNA, VPN and management software. | Sophos Endpoint Agent, Sophos Connect, Sophos ZTNA client |

### Security and identity

Hub only: no Sophos Firewall equivalent.

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| Antivirus and EDR (third party) | `security-and-identity/antivirus-and-edr-third-party` | Review | Security agents from other vendors; they may conflict with the Sophos agent. | Malwarebytes, ESET, Kaspersky, CrowdStrike Falcon |
| Password managers | `security-and-identity/password-managers` | Info | Vaults that store credentials, as apps or browser extensions. | Keeper, Bitwarden, 1Password, LastPass |
| Authenticators and MFA | `security-and-identity/authenticators-and-mfa` | Info | One-time password and passkey tools. | Microsoft Authenticator, Authy, YubiKey Manager |
| Encryption tools | `security-and-identity/encryption-tools` | Review | Disk, file or container encryption outside managed policy. | VeraCrypt, AxCrypt, Cryptomator |
| Security testing tools | `security-and-identity/security-testing-tools` | Review | Scanners, sniffers and offensive tools; legitimate for security teams and common in attacks. | Nmap, Advanced IP Scanner, Burp Suite, Metasploit |

### Developer tools

Hub only: no Sophos Firewall equivalent.

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| IDEs and editors | `developer-tools/ides-and-editors` | Info | Code editors and integrated development environments. | Visual Studio Code, Visual Studio, IntelliJ IDEA, Notepad++ |
| Language runtimes and SDKs | `developer-tools/language-runtimes-and-sdks` | Info | Compilers, interpreters and SDKs. | Node.js, Python, JDK, PHP, Go |
| CLIs and version control | `developer-tools/clis-and-version-control` | Info | Command-line tools, source control and cloud CLIs. | Git, GitHub CLI, AWS CLI, Azure CLI |
| Libraries and packages | `developer-tools/libraries-and-packages` | Info | Packages installed by npm, pip, Homebrew or Chocolatey that are libraries rather than apps. | typescript, requests, lodash |
| IDE extensions | `developer-tools/ide-extensions` | Info | Extensions for code editors that are not AI assistants. | ESLint, Prettier, Python for VS Code |

### Unwanted software

Hub only: no Sophos Firewall equivalent.

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| Adware and browser hijackers | `unwanted-software/adware-and-browser-hijackers` | Not allowed | Software that injects ads, changes the search engine or tracks browsing without clear consent. | Search hijacker extensions, bundled toolbars |
| Cracks and license bypass | `unwanted-software/cracks-and-license-bypass` | Not allowed | Keygens, activators and patched installers. | KMS activators, keygens |
| Crypto miners | `unwanted-software/crypto-miners` | Not allowed | Software that mines cryptocurrency on the computer. | XMRig, NiceHash Miner |

### Other

Hub only: no Sophos Firewall equivalent.

| Level 2 | Slug | Default attention | Description | Examples |
| --- | --- | --- | --- | --- |
| Other | `other/other` | Info | Software that fits no other category; use only when nothing else applies. |  |

Source of the level-1 names: [Sophos Firewall application control (Avanet)](https://www.avanet.com/en/kb/sophos-firewall-application-control/).
