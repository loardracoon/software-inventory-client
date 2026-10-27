# Phase H0: app shell and admin access

From `docs/spec.md`, section "Prompts do Hub" ("Fase H0: casca e acesso"). Plan first, implement, then verify with build and tests before the next phase.

Phase H0: app shell and admin access.
- Same design tokens and fonts as the Endpoint Inventory client.
- Sidebar: Inbox, Dictionary, Classification runs, Taxonomy, Clients, Settings.
- Auth with Lovable Cloud. Only users listed in hub_admins can sign in; everyone else gets an access-denied page. RLS denies all access to anonymous users.
- Notification bell in the top bar with the unread count from notifications.
