# Demo data for walkthrough videos

A local demo of Endpoint Inventory with **fictional data only**, for videos, screenshots and training. It runs on
an isolated local stack and never touches a real Sophos tenant, a real Hub or real data.

## What you get

- Two fictional companies, **Aurora Logistics** and **Brightline Clinics**, with 24 computers: Windows laptops and
  desktops (office, finance, reception, developers, IT), Macs and Ubuntu servers. One laptop is offline.
- Software by role: browsers, Microsoft 365, Zoom, Teams, 7-Zip, WinRAR, PuTTY, Docker, VS Code and its
  extensions, npm and pip packages, browser extensions, and a few problem cases (qBittorrent, Tor Browser, Hola
  VPN, Honey, Steam, AnyDesk).
- **Two weeks of history**: Chrome updates everywhere, 7-Zip upgraded on one laptop, AnyDesk removed, Tor Browser
  and Ollama installed in week 2.
- Categories from the mock Hub, and four **real public CVEs** with their NVD ranges and CISA KEV dates:
  CVE-2023-38831 (WinRAR before 6.23, known exploited), CVE-2025-0411 (7-Zip before 24.09, known exploited),
  CVE-2024-11477 (7-Zip before 24.07) and CVE-2024-31497 (PuTTY 0.68 to 0.80). EPSS is left empty on purpose.
- A published **application policy** in both companies.
- A **read-only viewer**, `demo.viewer@example.com`, and an admin, `admin.demo@example.com`.

## Build it

Needs Docker, Node and an isolated copy of `supabase/` (docs/operations.md › Tests: its own `project_id`, ports
553xx, `site_url = "http://localhost:5174"`). Ports 54998, 54999 and 5174 must be free.

```bash
scripts/demo/setup-demo.sh <isolated workdir>   # about 10 minutes; resets that stack's database
```

The script refuses a workdir with the main `project_id` or the API port 54321. It starts the demo mock of Sophos
Central (`mock-sophos-demo.mjs`, data in `fleet.mjs`), the mock Hub, the Edge Functions and the app on
<http://localhost:5174>, and runs both weeks through the real collector, normalizer, Hub sync, CVE matching and
policy evaluation. Logs go to `<workdir>/demo-logs/`.

## Sign in as the viewer

```bash
scripts/demo/viewer-link.sh <isolated workdir>   # prints a one-time sign-in link
```

Open the link in the browser, or in Playwright with `page.goto(link)`, then save the session with
`context.storageState({ path })` to reuse it for the whole recording. A link works once and expires after one hour;
run the script again for a new one.

The viewer sees every screen but cannot change anything, and the user names on computers are hidden from it.

## Change the data

Edit `fleet.mjs` (computers, software by role, week 2 changes, categories, CVEs) and run `setup-demo.sh` again.
