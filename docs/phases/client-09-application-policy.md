# Phase 9: application policy (CIS Controls v8.1, Control 2)

Plan first. Show the migration SQL, the evaluator module and the component list before writing code.

## Goal

Every program, browser extension, IDE extension and package in a tenant gets exactly one **policy class**, decided by an ordered list of rules that the tenant's admins write. The classes answer "does this organization allow this software?", while the Dictionary Hub categories answer "what is this software?". Classes are local to this app and are never sent to the Hub.

| Class | Machine id | Colour | Meaning | CIS v8.1 |
| --- | --- | --- | --- | --- |
| Core system | `core-system` | Slate `#6A889B` | Operating system, drivers, runtimes and security agents the asset needs to run | Authorized · 2.1, 2.5 |
| Sanctioned | `sanctioned-app` | Sophos Blue `#2006F7` | Approved for business use, with a business purpose and a supported version | Authorized · 2.1, 2.2, 2.5 |
| Tolerated | `tolerated-app` | Sky Blue `#009CFB` | Not authorized, kept under a documented exception with an owner, mitigating controls and a monthly review | Documented exception · 2.2, 2.3 |
| Unsanctioned | `unsanctioned-app` | Alert Red `#EA0022` | Unauthorized or unsupported with no exception; remove it from enterprise assets | Unauthorized · 2.3 |

CIS v8.1 itself speaks of authorized software, unauthorized software and documented exceptions (2.2: unsupported software without an exception is unauthorized; 2.3: unauthorized software is removed or gets a documented exception, reviewed monthly). The four classes map onto those terms as shown. Source: https://cas.docs.cisecurity.org/en/latest/source/Controls2/

## References in this repo

- `design/mock/Policies.dc.html`: policy page (class summary, rules, default class, title tester).
- `design/mock/PolicyRule.dc.html`: rule editor (conditions, class, documentation, live preview, history).
- `design/mock/Main.dc.html`: dashboard card "Application policy" with the class proportions.
- `design/mock/Software.dc.html`: Policy column and filter.
- `design/reference/policy-evaluator.js`: the evaluator the mock runs, with 42 sample titles and the 12 sample rules. Port it to TypeScript; its behaviour is the specification for the operators.
- `design/README.md` explains how to read `.dc.html` files.

**Where this file and the mock disagree, this file wins.** Two changes were decided after the mock:

1. The rules list is a **firewall-style table with drag and drop** (see "Rules table").
2. The **class cards are minimal**: description, machine id and CIS reference move into a tooltip (see "Class summary").

## Data model (migrations)

- Enums: `policy_class` (`core_system`, `sanctioned_app`, `tolerated_app`, `unsanctioned_app`); `policy_field` (`vendor`, `name`, `category`, `subcategory`, `version`, `external_id`); `policy_operator` (`equals`, `not_equals`, `contains`, `not_contains`, `starts_with`, `ends_with`, `regex`, `in`, `not_in`, `gt`, `gte`, `lt`, `lte`, `between`); `policy_status` (`draft`, `published`, `archived`); `rule_match` (`all`, `any`).
- `policies(id, tenant_id, version int, status policy_status, default_class policy_class default 'unsanctioned_app', note, created_by, created_at, published_by, published_at)`. At most one `draft` and one `published` per tenant (partial unique indexes).
- `policy_rules(id, policy_id, position int, name, class policy_class, match rule_match, kinds title_kind[], enabled bool, owner, business_purpose, mitigating_controls, risk_accepted_by, review_by date, alert_on_new bool, created_by, updated_at)`, `unique(policy_id, position) deferrable initially deferred` so a reorder can rewrite positions in one transaction.
- `policy_conditions(id, rule_id, position int, field policy_field, operator policy_operator, value text, value2 text, values text[], case_sensitive bool default false)`.
- `title_version_policy(tenant_id, title_id, version, policy_version, class, rule_id null, evaluated_at)`: the class of each installed (title, version) pair. `rule_id null` means the default class applied.
- View `title_policy`: one row per title with the most restrictive class among its installed versions (unsanctioned > tolerated > sanctioned > core) and a `mixed_versions` flag.
- `policy_class_changes(tenant_id, title_id, version, from_class, to_class, policy_version, changed_at)` for history.
- RLS: admins write policies, rules and conditions; analysts and viewers read. Every publish, reorder, enable/disable and delete writes `audit_log`.

Versions matter: a version condition applies to each installation's version, not to the title's newest version. "Acrobat below 24 is unsanctioned" must catch the computers still on 23 even when others run 25.

## Evaluator (one TypeScript module, used by the browser and by the Edge Function)

Put it in `supabase/functions/_shared/policy.ts` with no Deno or browser APIs, and import the same file from the front end through a Vite alias, so the editor preview and the server can never disagree.

- Rules run **top down**. Disabled rules are skipped. The **first** rule whose conditions match sets the class. If none matches, the policy's default class applies.
- A rule applies only to the kinds it lists (program, extension, ide_extension, package).
- `match = all`: every condition true. `match = any`: at least one true.
- Field values: vendor/publisher, canonical name, level-1 category, level-2 subcategory (both from `dictionary_cache`), installation version, external id (extension ID or package name).
- Text operators ignore case unless `case_sensitive`. `in` / `not_in` take `values[]` (categories) or a comma-separated `value` (text).
- `regex` uses JavaScript syntax, ignores case unless `case_sensitive`. Validate on save; max 200 characters; an invalid pattern blocks saving.
- Versions compare number by number on `.`, `-`, `+`, `_` and space (10.2 > 9.14; 21.011.20039 < 24); non-numeric parts compare as text; missing parts count as 0. `between` is inclusive and requires the lower value first.
- `evaluate(rules, title, default)` returns `{ class, ruleIndex, ruleId }`; `explain(rules, title, default)` returns, for each rule up to the match, whether it matched and the first condition that failed with the actual value (used by the title tester).
- Unit tests: every operator, case sensitivity, invalid regex, version edge cases, AND/OR, kinds, disabled rules, first match, default. Port the 42 sample titles and 12 rules from `design/reference/policy-evaluator.js` as a fixture; expected result: core system 6, sanctioned 13, tolerated 7, unsanctioned 16 (9 of them by the default class).

## Server

- Edge Function `policy-evaluate`: evaluates every installed (title, version) of a tenant against the published policy, upserts `title_version_policy`, writes `policy_class_changes` for pairs whose class changed, refreshes the counts used by the dashboard. Runs on publish and at the end of each ingest (`apply_snapshot`) for new titles or versions only. Pages through titles; stays within the function time limit like the collector.
- RPC `policy_publish(draft_id)`: validates (every rule has at least one valid condition and at least one kind; tolerated rules have owner, business purpose, mitigating controls, risk accepted by and a review date), archives the old version, publishes the draft, calls `policy-evaluate`, writes `audit_log`.
- RPC `policy_preview_inputs()`: returns the classification inputs of all current (title, version) pairs with their computer counts, for the editor's live preview.
- Optional alert: when a rule has `alert_on_new` and an ingest adds an installation that rule classifies as unsanctioned, send the alert through the Phase 8 channel.

## Screens

### Policies (`/policies`, new sidebar item after Software)

- Header: eyebrow "Application policy · CIS Controls v8.1 · Control 2", title, one line with the published version, who published it and when. Actions: Export policy (JSON), New rule.
- **Draft bar** when a draft exists: "Draft version N · M changes", Discard, Publish (admins only).
- **Class summary, minimal.** One row of four compact cards: colour dot, class name, number of titles and percentage. Nothing else on the card. The description, machine id and CIS reference appear in a **tooltip on hover and on keyboard focus** (shadcn `Tooltip`; use `HoverCard` or a tap-to-open `Popover` on touch). Each card is focusable and links to `/software?policy=<class>`. Use the same tooltip wherever a class badge appears (rules table, Software, dashboard legend, editor).
- **Overdue exceptions banner**: tolerated rules whose `review_by` is in the past, plus those due in the next 30 days, with a link to each rule.
- **Rules table, firewall style** (see below).
- **Title tester**: search a title (and pick a version if it has several), show the class it gets, the rule that matched and, for each earlier rule, why it did not match (from `explain`). It evaluates the draft when one exists, so reordering can be tested before publishing.

### Rules table

Like a firewall rule base, evaluated top down:

- Columns: drag handle, number (1…n), enabled switch, name and owner, conditions as readable chips joined by AND or OR, applies to, class badge, matches (titles · computers), review by (tolerated only, "Overdue" badge when past), row menu.
- **Drag and drop** rows to reorder with `@dnd-kit/core` and `@dnd-kit/sortable`: grip handle, a drop indicator line between rows, auto-scroll near the edges. Keyboard alternative from dnd-kit's keyboard sensor (Space to pick up, arrows to move, Space to drop, Escape to cancel) plus "Move up" and "Move down" in the row menu. Announce the new position to screen readers.
- Row menu: Edit, Duplicate, Insert rule above, Insert rule below, Move to top, Move to bottom, Enable/Disable, Delete.
- The **default rule is pinned as the last row** ("Default · any title that no rule matches"), with the default class selector and its counts. It cannot be dragged, disabled or deleted, like an implicit rule at the end of a firewall policy.
- Reorder, enable, disable, insert and delete change the **draft** only; the table shows the draft with changed rows marked until it is published.
- Filters above the table: search (name, owner, condition text) and class. While a filter is active, dragging is disabled and a hint says "Clear filters to reorder".

### Rule editor (`/policies/rules/:id`, `/policies/rules/new?position=N`)

- Name, position (number), enabled.
- **Class picker**: four compact radio options (dot + name). The description and CIS reference are in the same tooltip as the cards, not printed under each option.
- **Conditions**: "All conditions (AND)" or "Any condition (OR)"; one row per condition: field, operator (options depend on the field type), value. Text: is (exact match), is not, contains, does not contain, starts with, ends with, matches regex, is one of, is not one of, with an "Aa" case toggle. Category and subcategory: is, is not, is one of, is not one of, values picked from `categories_cache` (chips for lists). Version: =, ≠, >, ≥, <, ≤, between (two inputs), matches regex. Add and remove conditions; inline errors.
- **Applies to**: programs, browser extensions, IDE extensions, packages (at least one).
- **Documentation by class**: core and sanctioned ask for owner and business purpose (CIS 2.1). Tolerated asks for owner, business purpose, mitigating controls, risk accepted by and review by, with "Monthly, or sooner (CIS 2.3)" and a warning when the date is more than 31 days away. Unsanctioned asks for owner, reason and remediation, and "Alert when a new installation is detected".
- **Live preview** (right column, evaluates the draft in its position among the other rules): how many titles and computers match, which ones get this rule's class, which ones an earlier rule already classifies ("stays Sanctioned: rule 4 matches first"), and the list of titles whose class would change if the draft were published.
- Rule history from the policy versions. Save writes to the draft; Delete removes from the draft.

### Dashboard card "Application policy" (`/`, after the KPI row)

- A headline with the finding (for example "238 titles are unsanctioned, and 179 of them match no rule yet") and a link to `/policies`.
- Two 100% stacked horizontal bars, **Software titles** and **Installations**, in the class colours above, order core → sanctioned → tolerated → unsanctioned, 24 px high, 2 px surface gaps between segments, 4 px rounded outer ends.
- Each segment is a focusable link to `/software?policy=<class>` with a tooltip (class, count, percentage) on hover and focus.
- A legend under the bars with colour swatch, class name, titles with percentage and installations with percentage. It doubles as the table view; text stays in text colours, never in the class colour.
- Three facts beside the bars: unsanctioned installations and computers, overdue exceptions, titles that fall to the default class, each with a link.

### Other screens

- Software: Policy column (class badge with tooltip, matching rule as a link, "mixed versions" when versions differ) and a Policy class filter; `/software?policy=` preselects it.
- Computer detail: class badge per row in Programs, Extensions and Packages.
- Changes: show class changes from `policy_class_changes` as a fourth change type, "Class changed".

## Rules for this phase

- Never send classes, rules or anything about them to the Dictionary Hub.
- Colour never carries meaning alone: every class shows its name next to the colour.
- The sky-blue segment has low contrast on white; numbers always appear in the legend, never only inside the bar.
- Drag and drop must have the keyboard alternative described above.
- Use the Sophos DS 2026 tokens; the four class colours become tokens (`--class-core`, `--class-sanctioned`, `--class-tolerated`, `--class-unsanctioned`) in `src/styles/tokens.css`.

## Done when

- Migrations, RLS and generated types are in place; RLS tests show viewers cannot write rules.
- The evaluator unit tests pass, including the sample fixture totals above.
- Reordering by mouse and by keyboard changes the title tester's result before publishing; publishing updates the dashboard bars, the Software column and the class history.
- `CLAUDE.md` gains a "Policy classes" section: classes are local, rules run top down and first match wins, the evaluator lives in `supabase/functions/_shared/policy.ts`, version conditions apply per installation.
- `docs/phases/README.md` lists Phase 9 as done, with follow-ups.
