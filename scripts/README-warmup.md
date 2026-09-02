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

The script first reads all Mautic `email_stats` and `page_hits` rows in pages of
500 and aggregates them by lead ID in memory. It then reads contacts in pages of
200 and joins those aggregates without making per-contact requests. `--sample`
limits contacts only; both stats tables are always read in full. The output
prints the row count fetched from each stats table and the tier distribution.

It merges `mauticLastSentAt`, `mauticSentCount`, `mauticLastOpenedAt`,
`mauticOpenCount`, `mauticLastClickedAt`, `mauticClickCount`,
`mauticLastActiveAt`, `mauticPoints`, and `mauticEngagementTier` through the
public identify endpoint. Message IDs and user IDs are deterministic, so a
rerun is idempotent. Open timestamps prefer `last_opened` or `date_read` when
present and otherwise use `date_sent` for rows marked as read. Clicks are
`page_hits` rows with a non-null `email_id`.

The tier uses the newer of the last open and last click: hot through 30 days,
warm through 90 days, cool through 180 days, and cold after 180 days or when a
contact has never opened or clicked. `mauticLastActiveAt` and `mauticPoints` are
still included as traits but do not affect the tier.

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
node --test scripts/*.test.mjs
```
