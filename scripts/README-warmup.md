# Warm-up segments

`provision-warmup-segments.mjs` provisions the four declarative warm-up
segments from the `mauticEngagementTier` trait. That trait was written once by
a Mautic engagement backfill; Mautic was retired on 2026-10-21 and the backfill
script was removed, so the trait is historical and no longer refreshed. The
script defaults to dry-run and makes no changes unless `--live` is supplied.

## Provision warm-up segments

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
