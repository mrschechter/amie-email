# Visual (drag & drop) email editor — editor evaluation

Requested by Nicholate (spec §21): evaluate existing open-source editors before building one.
Checked 2026-10-21 against the npm registry and each project's repository/package contents.

| | GrapesJS + grapesjs-mjml | Easy Email | EmailBuilder.js | Unlayer (react-email-editor) | Mosaico |
|---|---|---|---|---|---|
| License | BSD-3-Clause (both) | MIT | MIT | Wrapper MIT; **editor is a hosted service** | **GPL-3.0** |
| Latest / activity | grapesjs 0.23.8 (published 2026-10-15); grapesjs-mjml 1.0.8 | 4.17.1 (2026-06) | **0.0.9** (pre-1.0) | 2.1.3 | 0.18.11 (2025-08) |
| Self-hosted | Yes, pure JS bundle | Yes | Yes | **No** — loads `https://editor.unlayer.com/embed.js`; features/branding tied to Unlayer plans | Yes |
| Email-safe responsive output | MJML → HTML (official MJML compiler) | MJML | Own React renderer → HTML (no MJML) | Yes (hosted) | Yes (template-based) |
| Fits Dittofeed (React/Next) | Mounts into a div; loaded client-only via `next/dynamic` | React, but brings the Arco design system alongside MUI | React | React wrapper around hosted iframe | Knockout.js app |
| Works with Dittofeed's pipeline | **Yes** — Amie Send already renders `body` as Liquid then MJML (`backend-lib/src/liquid.ts`, `mjml: true`), so the editor's MJML flows through send, preview and test-send unchanged | Yes (MJML) | Would need HTML-only path | Export HTML | Export HTML |
| Liquid personalization | Preserved verbatim in text and attributes (verified in a browser: `{{ user.firstName \| default: "there" }}`, `href="{% unsubscribe_url %}"`) | Likely | Likely | Merge tags are Unlayer's own syntax | Template-specific |
| Extensible blocks | Yes (Block/Component managers) | Yes | Limited | Paid custom tools | Template-bound |
| Editable design saved/reopened | Yes — `getProjectData()` / `loadProjectData()` round-trip verified identical | Yes (JSON) | Yes (JSON) | Yes (JSON, hosted editor) | Yes |
| Future cost/lock-in | None | None | None | **Yes** (plans, hosted dependency) | GPL obligations |

## Decision
**GrapesJS + grapesjs-mjml.** It is the one candidate that is permissively licensed, actively maintained,
fully self-hosted, produces MJML that Amie Send's existing renderer already compiles, preserves Dittofeed's
Liquid syntax, and ships the core email blocks (1/2/3 columns, text, image, button, divider, spacer,
social, navbar/header, hero, wrapper, raw HTML) plus drag & drop, layers, style manager, asset manager,
undo/redo and desktop/mobile devices. Unlayer is excluded because the actual editor is a hosted service;
Mosaico because of GPL-3.0 and its age; EmailBuilder.js because it is pre-1.0 and not MJML.

## How it is integrated
- New optional `visualDesign` on Code email templates: `{ version: 1, editor: "grapesjs-mjml", project, mjml, updatedAt }`.
- The visual editor writes MJML into `body` (the send source of truth) and stores the GrapesJS project
  for reopening. `mjml` records exactly what it wrote, so edits made elsewhere (Code tab, AI composer) are
  detected and the user chooses which version to keep — nothing is silently overwritten.
- No API, schema-migration, rendering or sending changes; existing templates are untouched.
