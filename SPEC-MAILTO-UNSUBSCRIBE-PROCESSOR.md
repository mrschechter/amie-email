# SPEC: mailto: unsubscribe (List-Unsubscribe) + inbound processor

Date: 2026-09-21. Branch `codex/mailto-unsubscribe-processor`. Implementer: Codex. No new runtime deps unless an existing workspace dependency cannot parse MIME headers (then justify in the report). No commits, no schema migration, no dashboard UI. Follow AGENTS.md (typecheck + eslint on touched packages, exact commands and results in the report). Use Node 22 (`/usr/bin/node`, first on PATH) and `corepack yarn`.

## Why
Gmail does not show its native Unsubscribe button on our mail although the RFC 8058 https one-click headers are correct and live. Our older Mautic mail (which Gmail does show the button for) carries BOTH `mailto:` and `https:` in `List-Unsubscribe`. Ian (2026-09-21) approved adding the `mailto:` form. It must actually work: mail to the unsubscribe mailbox has to unsubscribe the sender without a human.

## Infrastructure already in place (do not create)
- SES receiving: MX for `send.tryamie.com`, `mail.tryamie.com`, `em.tryamie.com` → `inbound-smtp.us-east-1.amazonaws.com`; SES receipt rule stores every message for those domains as a raw MIME object in S3 bucket `amie-inbound-email-402589123885`, key prefix `inbound/` (object key = SES message id).
- The workspace's SES email provider credentials (Secret table, type `AmazonSes`, IAM user `amie-dittofeed-ses`, region us-east-1) now have `s3:ListBucket` on that bucket and `s3:GetObject/PutObject/DeleteObject` on `inbound/*` and other prefixes. Reuse those credentials (same pattern as the SES sender: read the provider config through the existing email-provider helpers) — do NOT read from `blobStorage` config, that is a different store.

## Required changes
1. **Header.** `packages/backend-lib/src/messaging/email.ts` `constructUnsubscribeHeaders`: when config `unsubscribeMailtoEnabled` (env `UNSUBSCRIBE_MAILTO_ENABLED`, default `false`) is true, emit `List-Unsubscribe: <mailto:unsubscribe@<from-domain>?subject=unsubscribe>, <https://…existing URL…>` (mailto first, then https, both in angle brackets, comma-separated per RFC 2369). Keep `List-Unsubscribe-Post` and `List-ID` unchanged. When the flag is false the header is byte-identical to today.
2. **Processor.** New module `packages/backend-lib/src/inboundUnsubscribe.ts` exporting `processInboundUnsubscribes({ workspaceId, s3Impl?, nowImpl?, limit = 200 })`:
   - Lists objects under `inbound/` (paginate up to `limit` per run).
   - For each object: GetObject, parse ONLY the top-level RFC 5322 headers (`To`, `Cc`, `Delivered-To`, `X-Original-To`, `From`, `Return-Path`, `Subject`, `Message-ID`, `Auto-Submitted`). Handle folded headers and quoted display names; do not load the body into memory beyond the header block (stop at the first blank line; cap read at 64 KB).
   - It is an unsubscribe request when any recipient address local part is `unsubscribe` (case-insensitive) on a domain in config `unsubscribeMailboxDomains` (env `UNSUBSCRIBE_MAILBOX_DOMAINS`, comma-separated, default `send.tryamie.com,mail.tryamie.com,em.tryamie.com`). Sender = `From` address (fallback `Return-Path`). Ignore `Auto-Submitted: auto-*` senders (bounces/auto-replies) — move them to `other/`.
   - Resolve the user by email identifier the same way the subscription-management page does (find the helper used by `lookupUserForSubscriptions`/`user-subscriptions`; match on the `email` user property, case-insensitive). If found: unsubscribe from ALL email-channel subscription groups via `updateUserSubscriptions` (exactly what the one-click path does when no `s` param is given), then `submitTrack`-style log event `mailto_unsubscribe` is NOT required — write a `logger().info` with `{ event: "mailto_unsubscribe", workspaceId, userId, messageId, result }` plus an OpenTelemetry counter `mailto_unsubscribe_processed` with a `result` attribute (`unsubscribed` | `user_not_found` | `not_unsubscribe` | `auto_submitted` | `error`).
   - Move processed objects: copy to `processed/<key>` (unsubscribes, user_not_found) or `other/<key>` (everything else), then delete the original. On any error leave the object in place and continue (retry next run); never delete without a successful copy.
   - Return `{ scanned, unsubscribed, userNotFound, other, errors }`.
3. **Scheduling.** Run it every 5 minutes inside the existing worker process using whatever periodic mechanism the codebase already has (look at how `computePropertiesScheduler`, `globalCron`, or Temporal schedules are started in `packages/worker` / `packages/backend-lib/src/*Scheduler*`). Gate with config `unsubscribeMailtoProcessorEnabled` (env `UNSUBSCRIBE_MAILTO_PROCESSOR_ENABLED`, default `false`), bucket `UNSUBSCRIBE_INBOUND_BUCKET` (default `amie-inbound-email-402589123885`), prefix `UNSUBSCRIBE_INBOUND_PREFIX` (default `inbound/`). Single-tenant: use the default workspace id the way other schedulers do.
4. **Admin CLI** (optional, only if trivial): `packages/admin-cli` command `process-inbound-unsubscribes --dry-run` printing the counts without moving objects.

## Tests (pure unit, no S3/Postgres; inject `s3Impl`, lookup and update functions)
a. header: flag off → unchanged; flag on → `<mailto:unsubscribe@send.tryamie.com?subject=unsubscribe>, <https://…>` order and brackets exact.
b. header parser: folded `To:` line, display name with comma in quotes, `Delivered-To` only, uppercase local part → all detected; body never read past the blank line.
c. processor: unsubscribe mail → user resolved → update called with every email group false → object copied to `processed/` then deleted.
d. unknown sender → `user_not_found`, moved to `processed/`.
e. non-unsubscribe recipient → `other/`.
f. `Auto-Submitted: auto-replied` → `auto_submitted`, `other/`.
g. copy fails → object left in place, `errors` incremented, next object still processed.

## Gate (paste into `REPORT-MAILTO-UNSUBSCRIBE-PROCESSOR.md`)
```
corepack yarn workspace emailo build
corepack yarn workspace backend-lib check
corepack yarn workspace backend-lib eslint <touched files>
corepack yarn jest <new test files> --runInBand --config '{"testEnvironment":"node","clearMocks":true,"transform":{"^.+\\.tsx?$": ["ts-jest", {"tsconfig":"<rootDir>/packages/backend-lib/tsconfig.json"}]}}'
```
(The repo's default jest global setup needs ClickHouse/Postgres which this machine lacks; the isolated config is the accepted fallback — say so in the report.) Report: what changed, which periodic mechanism you hooked into, test counts, anything not done. Do NOT commit.
