# Phase 0: app shell and design system

From `docs/spec.md`, section "Prompts do cliente" ("Fase 0: casca do app e design system"). Plan first, implement, then verify with build and tests before the next phase.

> **Repo note:** Copy `design/tokens/tokens.css` to `src/styles/tokens.css` and the fonts in `design/tokens/fonts/` to `public/fonts/` (or load them from Google Fonts as the prompt says).

Phase 0: app shell and design system. Do not build data features yet.

1. Create src/styles/tokens.css with the Sophos Design System 2026 tokens as CSS variables (light on :root, dark on [data-theme="dark"]):
   dark-blue #001A47, sophos-blue #2006F7, cyber-blue #00EDFF, cyber-green #00F2B3, light-neutral #EDF2F9, slate #6A889B, neutral-300 #BBCFDE, neutral-800 #223E4C, sky-blue #009CFB, alert-red #EA0022, alert-orange #F29400, alert-yellow #F8E300, alert-lime #AAFF00, alert-green #00EF0B.
   Semantic (light / dark): surface-page #FFFFFF / #001A47, surface-subtle #EDF2F9 / #0F2852, surface-raised #FFFFFF / #1A3159, text-strong #001A47 / #FFFFFF, text-body #001A47 / #EDF2F9, text-muted #223E4C / #BBCFDE, text-brand #2006F7 / #00EDFF, border-subtle #BBCFDE / #293F64, border-control #6A889B, action #2006F7 / #00EDFF, action-hover #170CB7 / #0BD3E2, on-action #FFFFFF / #001A47, focus-ring #5A00FF / #00EDFF.
   Radius: sm 8px, lg 16px, pill 999px. Spacing on a 4px grid. Map them into tailwind.config and the shadcn theme.
2. Fonts from Google Fonts: Zalando Sans (body, CTAs), Zalando Sans Expanded (headlines, eyebrows), Zalando Sans SemiExpanded (subheadlines).
3. Layout: a left sidebar (a drawer on phones) with the product name and nav items Overview, Computers, Software, Changes, Scans, Settings. A top bar with a tenant switcher, a global search box that routes to /software?q=, a theme toggle and the user menu.
4. Routes: /, /computers, /computers/:id, /software, /software/:titleId, /changes, /scans, /settings.
5. Auth: Supabase Auth (email magic link for now; SSO comes later). A profiles table with role enum admin | analyst | viewer. Protect every route.
6. Shared components: KpiCard, StatusBadge (collected, dispatched, retry scheduled, missed, error) that always shows a word and an icon, never colour alone, CategoryTag, ServerDataTable (TanStack Table with server-side paging, sorting and filters), EmptyState, PageHeader with eyebrow + title.
