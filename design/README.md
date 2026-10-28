# Design references

The clickable mock was built in Claude Design with the Sophos Design System 2026. Live version (sample data): https://claude.ai/artifact/PA4LZt6mcUmgTabUC2zPcC

The files here are references, not code to copy. Rebuild each screen with React, Tailwind and shadcn/ui on top of `tokens/tokens.css`, wired to real data.

## Folders

- `mock/*.dc.html`: one file per screen (see the table below).
- `tokens/tokens.css`: the DS 2026 tokens as CSS variables (light on `:root`, dark on `[data-theme="dark"]`) and the `@font-face` rules. Copy it to `src/styles/tokens.css`.
- `tokens/fonts/`: Zalando Sans, Zalando Sans Expanded and Zalando Sans SemiExpanded (variable woff2, SIL OFL). Copy to `public/fonts/` and fix the `url()` paths, or load the same families from Google Fonts.
- `tokens/tokens.json`: the same tokens as data.
- `tokens/components-reference.css`: the CSS of the DS components the mock uses, as a reference for sizes, states and spacing.

## Screens

| File | App | Route | What it answers |
| --- | --- | --- | --- |
| `Main.dc.html` | Client | `/` | How are the fleet and this week's collection? |
| `Computers.dc.html` | Client | `/computers` | Who is collected, on retry or in error? |
| `Computer.dc.html` | Client | `/computers/:id` | What is on this computer now, and what was there before? |
| `Software.dc.html` | Client | `/software` | Where is a title or a category? Includes the reclassification request dialog |
| `Scans.dc.html` | Client | `/scans` | Is the collector healthy? Cycle, API budget, retry queue |
| `Changes.dc.html` | Client | `/changes` | What changed, where and when? |
| `Policies.dc.html` | Client | `/policies` | Which class does each app get, and which rule decides it? (Phase 9) |
| `PolicyRule.dc.html` | Client | `/policies/rules/:id` | Edit one rule: conditions, class, documentation, live preview (Phase 9) |
| `HubInbox.dc.html` | Hub | `/` (Inbox) | Requests, new titles, Jev proposals |
| `HubEntry.dc.html` | Hub | `/entries/:id` | Edit an entry, research dossier, decide a request |
| `HubEngines.dc.html` | Hub | `/engines` | Jev and research modes, budgets, auto-published list, prices |
| `HubTaxonomy.dc.html` | Hub | `/taxonomy` | Browse and edit the 29 categories and 71 subcategories |

Each repo holds only its own screens.

## How to read a `.dc.html` file

- The markup inside `<x-dc>` is the screen. `<helmet><style>` holds screen-level CSS.
- `{{name}}` is a binding. Its value comes from `renderVals()` in the `<script type="text/x-dc">` block at the end.
- `<sc-for list="{{rows}}" as="r">` repeats its content per item; `<sc-if value="{{flag}}">` renders only when true.
- `<x-import component-from-global-scope="SophosDS.Badge" color="high">` is a DS component. Map it to the equivalent shadcn component styled with the tokens.
- Arrays at the top of the script (`CP_ROWS`, `SW_TITLES`, `CD_RAW`, `HI_PROPOSALS`, `TX_ROWS`…) are sample data. They show the shape and wording of real rows; real data comes from the database. The extension rows in `Computer.dc.html` come from a real export, with usernames replaced by user01–user03 as in `fixtures/extensions_lab-pc01.csv`.

## Component mapping

| Mock component | Build with | Notes |
| --- | --- | --- |
| `SophosDS.Card` | shadcn `Card` | `tone="inverse"` = dark-blue card; `tone="subtle"` = surface-subtle |
| `SophosDS.Badge` | shadcn `Badge` | colours: `critical` alert-red, `high` alert-orange, `medium` alert-yellow, `safe` alert-green, `info` sky-blue, `blue` sophos-blue, `slate`, `dark`; `soft` = tinted background |
| `SophosDS.AlertLevel` | `StatusBadge` | always a word plus an icon, never colour alone |
| `SophosDS.Tabs` | shadcn `Tabs` | tabs carry a count badge |
| `SophosDS.Input`, `Select`, `Checkbox`, `Switch` | shadcn equivalents | labels above fields, hint text below |
| `SophosDS.Dialog` | shadcn `Dialog` | primary and secondary actions in the footer |
| `SophosDS.Toast` | `sonner` toast | tones success, info, critical |
| `SophosDS.ProgressBar` | shadcn `Progress` | label above the bar with value and limit |
| `SophosDS.Eyebrow` | small uppercase label | Zalando Sans Expanded 11 px, letter-spacing 0.1em; `tick` adds the brand tick |
| `SophosDS.Tag` (`sds-tag`) | toggle chip | category filter chips, `aria-pressed` |
| `SophosDS.Logo` | brand asset | not included here; use the official Sophos logo files |

## Categories on screen

Show the category as two lines: level 1 small and muted, level 2 below it. Add an attention badge when the level-2 attention is Review (`high`, orange) or Not allowed (`critical`, red); Info shows no badge in lists. Under it, show where the category came from ("Hub · reviewed", "Hub · Jev 0.97", "Local override", "Unclassified").
