# Codex work brief: Mautic → Amie Send audience + suppression migration script

## Goal
A standalone, idempotent migration script `scripts/mautic-migrate.mjs` (plain
Node 20+ ESM, global fetch, NO repo imports, NO npm deps — it will be executed
on a separate runner that only has node) that copies the marketing audience and
the suppression list from Mautic into Amie Send, making the platform safe to
send from.

## Source (Mautic REST, basic auth)
Env: MAUTIC_BASE_URL, MAUTIC_API_USERNAME, MAUTIC_API_PASSWORD.
- Contacts: `GET /api/contacts?limit=200&start=N&where[0][col]=email&where[0][expr]=isNotNull`
  — ~27,302 contacts. NOTE: query params must be URL-encoded exactly as shown
  (bracket syntax). Each contact: `fields.core` map (email, firstname,
  lastname, ...; each entry is {value}), `tags` array, `dateAdded`, `id`.
  Total count in `total`. Do NOT use `search=` operators — they are broken on
  this instance; only where[] filters.
- Suppression: `GET /api/stats/lead_donotcontact?limit=500&start=N` → rows
  `{lead_id, channel, reason, comments, date_added}`, `total` (~232). Only
  channel `email` matters. Resolve each distinct lead_id to its email via
  `GET /api/contacts/{id}` (cache; skip rows whose contact has no email).

## Destination (Amie Send public API)
Env: AMIE_SEND_BASE_URL (default https://email.tryamie.com), AMIE_SEND_WRITE_KEY.
Auth: `authorization: <writeKey>` header, exactly as publicAppsController expects
(see packages/api/src/controllers/publicAppsController.ts and the WriteKey
verification it calls — replicate the correct header format).
- Upsert users via POST `/api/public/apps/identify`:
  `{ userId, traits: { email, firstName, lastName, mauticId, mauticTags, createdAt } }`.
  userId MUST be deterministic from the email: uuid v5 of the lowercased
  trimmed email with a fixed namespace UUID declared as a constant — so reruns
  are idempotent and portal events can adopt the same convention later.
- Suppression: for each DNC email, after identify, emit the subscription
  opt-out the same way the platform itself records an unsubscribe — study
  packages/backend-lib/src/subscriptionGroups.ts (buildSubscriptionChangeEvent /
  updateUserSubscriptions) and use the PUBLIC api surface that achieves it
  (track event `{ event: "Subscription Change" ... }` or the documented
  endpoint). Target subscription group id: env AMIE_SEND_EMAIL_SUBSCRIPTION_GROUP_ID
  (the "Amie - Email" group). The result must be: user shows Unsubscribed for
  that group in the dashboard and is excluded from sends.

## Behavior requirements
- Batching + pacing: ≤10 concurrent requests, small delay between pages;
  retry 429/5xx up to 3 times with backoff; abort the run (nonzero exit) after
  25 consecutive failures.
- Idempotent: re-running produces the same state (deterministic userIds,
  identify is an upsert, opt-out re-emission is harmless).
- Flags: `--dry-run` (default TRUE: export + count + print 3 sample payloads,
  no writes), `--execute` to write; `--only-suppression` to run just the DNC
  pass. Progress log every 1000 contacts; final summary JSON on one line
  prefixed `##MIGRATION `.
- No secrets ever printed.

## Also add
`scripts/mautic-migrate.test.mjs` — node:test unit tests for the pure pieces
(userId derivation, contact→traits mapping, DNC row filtering/email join,
retry/backoff decision logic) with fetch stubbed. Runnable via `node --test scripts/`.

## WRITABLE SURFACES (hard fence)
- scripts/mautic-migrate.mjs (new)
- scripts/mautic-migrate.test.mjs (new)
Nothing else. Read anything, write only these.

## Definition of done
`node --test scripts/` green; summarize the exact public-API calls used for
identify and opt-out with file:line references to the server code that accepts
them.
