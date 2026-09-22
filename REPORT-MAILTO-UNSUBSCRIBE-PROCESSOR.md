# Mailto unsubscribe processor report

Implemented on `codex/mailto-unsubscribe-processor`. No commits.

## Changes

- `constructUnsubscribeHeaders` prepends `<mailto:unsubscribe@<from-domain>?subject=unsubscribe>, ` when enabled, including senders with quoted display names. Disabled output, `List-Unsubscribe-Post`, and `List-ID` are unchanged.
- Added `processInboundUnsubscribes({ workspaceId, s3Impl?, nowImpl?, limit = 200 })`, with additional injectable lookup, subscription-update, and email-group functions for unit tests. It paginates within the limit, requests at most 64 KB per object, stops parsing at the first blank line, and closes the stream. Only the specified top-level headers are retained. Nodemailer's existing address parser handles address lists, folded fields, quoted names, and groups; no dependency was added.
- Reused the existing SES provider/config resolution by exporting `getEmailProvider` from `messaging.ts`. S3 receives that provider's region and explicit credentials; it does not use blob-storage configuration or the SES endpoint.
- Reused `findUserIdsByUserPropertyValue`, the subscription page's lookup helper. Added an optional case-insensitive comparison using `lowerUTF8` on both operands; existing callers retain their original comparison. The processor looks up the `email` property and calls `updateUserSubscriptions` with every email-channel group set to false.
- Unsubscribes and unknown users move to `processed/<original-key>`; other recipients and `Auto-Submitted: auto-*` messages move to `other/<original-key>`. Copy must succeed before deletion. Object errors retain the source and do not stop later objects. Logs include the required event/result context, and `mailto_unsubscribe_processed` counts each result. Returns the five requested counts.

## Configuration and scheduling

| Environment variable | Default |
| --- | --- |
| `UNSUBSCRIBE_MAILTO_ENABLED` | `false` |
| `UNSUBSCRIBE_MAILTO_PROCESSOR_ENABLED` | `false` |
| `UNSUBSCRIBE_MAILBOX_DOMAINS` | `send.tryamie.com,mail.tryamie.com,em.tryamie.com` |
| `UNSUBSCRIBE_INBOUND_BUCKET` | `amie-inbound-email-402589123885` |
| `UNSUBSCRIBE_INBOUND_PREFIX` | `inbound/` |

Hooked into the existing Temporal `globalCronWorkflow`, whose existing `startGlobalCron` uses `*/5 * * * *`. The new activity is exported through the existing worker activity registry and runs alongside `emitGlobalSignals`. A Temporal patch marker preserves replay of older histories. The activity checks the processor flag before accessing the database or provider, and selects the default workspace with `db().query.workspace.findFirst()`, matching the single-tenant request-context convention. No additional timer, process, or infrastructure was created.

## Gates

The initial shell selected Node 24. Each Yarn command below ran after `export PATH=/usr/bin:$PATH`, selecting `/usr/bin/node` v22.22.1 and Corepack Yarn 4.1.1.

```bash
corepack yarn workspace emailo build
```

PASS, exit 0. Existing Vite CJS, punycode, and outdated Browserslist warnings only.

```bash
corepack yarn workspace backend-lib check
```

PASS, exit 0. An initial test-fixture type error was corrected before the successful check.

```bash
corepack yarn workspace backend-lib eslint src/config.ts src/messaging/email.ts src/messaging.ts src/userProperties.ts src/inboundUnsubscribe.ts src/inboundUnsubscribe.test.ts src/inboundUnsubscribeLookup.test.ts src/messaging/unsubscribeHeaders.test.ts src/globalCronWorkflow.ts src/globalCronWorkflow.test.ts src/temporal/activities.ts
```

FAIL, exit 1: eight pre-existing `@typescript-eslint/consistent-type-assertions` errors and two pre-existing warnings in three existing files. There are no remaining new lint errors.

| File | Existing error lines in current checkout |
| --- | --- |
| `src/messaging.ts` | 585, 594, 1070, 2356, 2362, 2365 |
| `src/messaging/email.ts` | 191 |
| `src/userProperties.ts` | 815 |

The warnings are `prefer-nullish-coalescing` in `messaging.ts:2701` and `no-unnecessary-condition` in `messaging/email.ts:204`. Confirmed against the original files with these read-only commands; each returned exit 1 with the corresponding existing findings (the original `messaging.ts` also had an import-sort error fixed by formatting):

```bash
git show HEAD:packages/backend-lib/src/messaging.ts | corepack yarn workspace backend-lib eslint --stdin --stdin-filename src/messaging.ts
git show HEAD:packages/backend-lib/src/messaging/email.ts | corepack yarn workspace backend-lib eslint --stdin --stdin-filename src/messaging/email.ts
git show HEAD:packages/backend-lib/src/userProperties.ts | corepack yarn workspace backend-lib eslint --stdin --stdin-filename src/userProperties.ts
```

Additional lint check for all other touched files:

```bash
corepack yarn workspace backend-lib eslint src/config.ts src/inboundUnsubscribe.ts src/inboundUnsubscribe.test.ts src/inboundUnsubscribeLookup.test.ts src/messaging/unsubscribeHeaders.test.ts src/globalCronWorkflow.ts src/globalCronWorkflow.test.ts src/temporal/activities.ts
```

PASS, exit 0.

```bash
corepack yarn jest packages/backend-lib/src/inboundUnsubscribe.test.ts packages/backend-lib/src/inboundUnsubscribeLookup.test.ts packages/backend-lib/src/messaging/unsubscribeHeaders.test.ts packages/backend-lib/src/globalCronWorkflow.test.ts --runInBand --config '{"testEnvironment":"node","clearMocks":true,"transform":{"^.+\\.tsx?$": ["ts-jest", {"tsconfig":"<rootDir>/packages/backend-lib/tsconfig.json"}]}}'
```

PASS, exit 0: **4 suites, 39 tests**. These are pure unit tests with mocked S3/database/provider boundaries and injected lookup/update functions. They cover every required case (a–g), stream limits and closure, Return-Path fallback, exact domain matching, case-insensitive query construction, pagination, copy/delete order, failure continuation, SES credential selection, the disabled scheduler, default-workspace resolution, and workflow replay compatibility.

The repository's default Jest global setup requires ClickHouse/Postgres, which this machine lacks. The spec's isolated configuration above is the accepted fallback and was used instead. No live S3, SES, Postgres, ClickHouse, or Temporal calls were made.

`git diff --check`: PASS, exit 0.

## Not done / remaining

- Full touched-file lint remains blocked by the eight verified existing errors above. Unrelated behavior was not refactored to repair those errors.
- Optional admin dry-run CLI omitted.
- No production integration test, infrastructure change, feature-flag activation, campaign/content change, schema migration, dashboard change, commit, push, PR, merge, or deployment. The supplied spec was preserved unchanged.
