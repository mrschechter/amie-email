# Mautic engagement warm-up

These scripts backfill Mautic engagement traits into Amie Send, then provision
the four declarative warm-up segments. Both scripts default to dry-run and make
no changes unless `--live` is supplied.

## 1. Backfill engagement traits

Required environment variables:

- `MAUTIC_BASE_URL`
- `MAUTIC_API_USERNAME`
- `MAUTIC_API_PASSWORD`
- `AMIE_SEND_WRITE_KEY` for `--live` only
- `AMIE_SEND_BASE_URL` (defaults to `https://email.tryamie.com`)

Preview a bounded sample:

```bash
node scripts/mautic-engagement-backfill.mjs --sample 400 --dry-run
```

Backfill every contact:

```bash
node scripts/mautic-engagement-backfill.mjs --live
```

The script reads contacts in pages of 200, uses engagement fields already
present in the list response, and never makes a per-contact request. It merges
only `mauticLastActiveAt`, `mauticPoints`, and `mauticEngagementTier` through
the public identify endpoint. Message IDs and user IDs are deterministic, so a
rerun is idempotent.

`mauticLastActiveAt` is the latest valid timestamp found among Mautic's
`lastActive`, `fields.core.last_active`, `fields.all.last_active`,
`dateModified`, `dateAdded`, and any email open/click/read/engagement timestamp
already included in the contact list payload. SQL-style timestamps without an
offset are treated as UTC. Tiers are hot through 30 days, warm through 90 days,
cool through 180 days, and cold after 180 days or when no timestamp is present.

## 2. Provision warm-up segments

Dry-run needs no environment variables:

```bash
node scripts/provision-warmup-segments.mjs --dry-run
```

Live mode uses the same single-tenant login and session cookie as the dashboard.
Set:

- `AMIE_SEND_BASE_URL`
- `AMIE_SEND_WORKSPACE_ID`
- `AMIE_SEND_PASSWORD` (or the deployment's existing `PASSWORD` variable)

Then run:

```bash
node scripts/provision-warmup-segments.mjs --live
```

For automation with an existing authenticated session, set
`AMIE_SEND_SESSION_COOKIE` instead of a password. The script lists declarative
segments by workspace, matches the four names, and sends each definition to
`PUT /api/segments`, including the existing ID when updating.

## Tests

```bash
node --test scripts/mautic-engagement-backfill.test.mjs scripts/provision-warmup-segments.test.mjs
```
