# SPEC: AI-Native Template Builder ("Amie Send" email design)

**Owner:** Hermes (build via PRs per AGENTS.md). **Approved:** Ian, 2026-09-01.
**Design reference:** `design/amie-send-mockup.html` (open in a browser — match its
visual direction: ivory #FAF8F5 ground, warm minimal UI, assistant beside preview).

## Goal
Template building/email design is **AI-native first**: the user describes the email
(or asks for changes) in an assistant chat panel and watches a live preview update.
**Direct HTML injection is the secondary path**: paste raw email HTML and use it
as the template body, still editable by the assistant afterwards. The existing
low-code editor remains available but is no longer the default for email templates.

## Where it lives
- UI: `packages/dashboard` template editor area (`templateEditor.tsx`,
  `templatePreview.tsx`); add an "Assistant" tab (default) and an "HTML" tab
  (injection) alongside the existing editor.
- Backend: new endpoint in `packages/api` + logic in `packages/backend-lib`,
  e.g. `POST /api/assistant/template` — the browser NEVER calls the model
  directly and never sees the API key.

## Assistant contract (backend)
- Model: Anthropic Messages API, model from env `AMIE_ASSISTANT_MODEL`
  (default `claude-sonnet-5`), key from env `ANTHROPIC_API_KEY`.
- Input: current template state (subject, preheader, body HTML), the user's
  instruction, and conversation context. Output: structured JSON
  `{ subject, preheader, bodyHtml, note }` — full replacement state each turn.
- System prompt must encode:
  - Amie brand: blush `#F5E6E0`, deep teal `#2D7A7A`, warm ivory `#FAF8F5`,
    sage `#9CAF88`; serif display (Georgia/Cormorant fallback stack) +
    system/DM Sans body; premium, warm, medically credible tone; women 35–60.
  - Email-safe HTML only: table layout, inline CSS, max-width 600px, alt text
    on images, safe dark-mode colors, no external scripts/fonts beyond safe
    fallbacks.
  - Preserve Dittofeed liquid/merge tags exactly (e.g. `{{ user.firstName }}`,
    unsubscribe tag). Marketing templates MUST contain the unsubscribe tag —
    if missing, the assistant adds a compliant footer.
  - It edits DRAFT templates only; it never sends, schedules, or publishes.
- Cost/abuse guardrails: cap request size, rate-limit per user, log usage.

## HTML injection (secondary path)
- "HTML" tab: paste-or-upload raw HTML → becomes the template body.
- Sanitize: strip `<script>` and event handlers; keep everything else verbatim.
- Warn (non-blocking) when the unsubscribe tag or `{{ }}` merge fields are absent.
- After injection, the Assistant tab operates on the injected HTML.

## Out of scope (do NOT touch)
SES/DNS/sending config; campaign/broadcast content or sending; journeys logic;
anything outside this repo. Sending stays human-owned.

## Delivery plan — small gated PRs, in order
1. Backend assistant endpoint + system prompt + tests (mock the model client).
2. Assistant tab UI: chat panel + live preview wired to existing template
   save/draft flow; loading/error states; "Save draft" only.
3. HTML injection tab with sanitizer + warnings + tests.
4. Stretch: "Make an SMS version" action producing an SMS template draft.

Each PR: repro/feature notes, exact test commands + results in the body
(see AGENTS.md). The gating agent reviews, merges, and deploys.
