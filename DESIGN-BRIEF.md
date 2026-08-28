# Design Brief — Amie email platform dashboard (fork of Dittofeed)

Feed this to Claude design. Goal: a full visual identity for our internal
email platform at email.tryamie.com, designed AGAINST THE EXISTING SCREEN
STRUCTURE so engineering can implement it as a theme + shell redesign, not an
app rewrite.

## Product
Internal ESP ("Klaviyo, but ours") used by 1–3 marketing/CX people. Users
build customer segments, email templates, and automated journeys, send
broadcasts, and read delivery analytics. It must feel like an Amie-family
tool: premium, warm, medically credible — same family as our patient portal
and consoles, NOT a generic dev tool.

## Name
Working name: (Ian to decide — e.g. "Amie Mail"). Design a simple wordmark/
lockup for the sidebar; no standalone logo project needed.

## Brand tokens (source of truth: tryamie brand system)
- Blush #F5E6E0 · Ivory #FAF8F5 · Deep Teal #2D7A7A (primary action) ·
  Sage #9CAF88 · Rose Gold #B76E79 (sparing) · Warm Grey #4A4A4A text ·
  never pure black
- Type: Cormorant Garamond for page titles only; DM Sans for everything else
  (data-dense UI should lean DM Sans; don't serif the tables)
- Buttons/cards/radii per the Amie console family: 8–12px radii, soft
  shadows, generous whitespace

## Screens to design (in priority order — these exist today; keep their
information architecture, redesign their look)
1. Shell: left sidebar nav (Journeys, Segments, Templates, Broadcasts,
   Deliveries/Analytics, Settings), page header, user area. This is 60% of
   the perceived redesign.
2. Journeys list + Journey detail header (the canvas itself — nodes/edges —
   only needs COLOR/typography theming, not structural redesign: node card
   style, edge color, canvas background).
3. Segments list + segment builder (condition rows — style the rows/selects).
4. Templates list + template editor chrome (editor panes stay; theme the
   chrome, buttons, preview frame).
5. Broadcasts (list + compose/review step).
6. Deliveries/analytics table + simple stat cards (sent/delivered/open/click/
   bounce). Design a stat-card style we can reuse.
7. Login page (single password field) — first impression, make it ours.
8. CUSTOMER-FACING (design carefully, it's public): unsubscribe / manage
   preferences page — Amie-branded, calm, one-click unsubscribe compliant.
9. Base EMAIL template: master layout for all marketing emails — Amie header,
   footer (address, unsubscribe), mobile-first, bulletproof-simple HTML look.

## Hard constraints (so it's implementable)
- It's a Next.js app with MUI-based components; deliver the design as a token
  sheet (colors, type scale, spacing, radii, shadows) + per-screen mockups.
  Avoid bespoke per-screen layouts that break component reuse.
- Information density matters: these are working tools — no oversized hero
  sections inside the app.
- Light theme only for v1.
- Every screen: what does the primary teal action button do — one per screen.

## Out of scope
Journey canvas interaction redesign, template editor internals, multi-user/
roles, dark mode, marketing-site pages.
