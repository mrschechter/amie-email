# SPEC: Amie email platform — production stand-up config (Phase 1)

This repo is Amie's fork of Dittofeed (upstream stalled 2026-03; we own this fork).
Goal of Phase 1: a production-ready self-host deployment package so the ops team
can run this at **email.tryamie.com** on a single EC2 box with docker compose,
fronted by a Cloudflare Tunnel. NO upstream source-code changes in this phase —
infra/config files only.

## Deliverables (all NEW files under `deploy/`)

### 1. `deploy/docker-compose.prod.yaml`
Derive from the repo's `docker-compose.lite.yaml` (lite = api+dashboard+worker in
one container). Changes vs lite:
- Pin all image tags explicitly (use the tag lite currently defaults to; no
  `latest`, no default-fallback interpolation for versions — hard-code them).
- **No insecure defaults**: `DATABASE_PASSWORD`, `CLICKHOUSE_PASSWORD`,
  `SECRET_KEY`, `PASSWORD` (dashboard login), `CLOUDFLARE_TUNNEL_TOKEN` must come
  from `.env` with NO fallback default (`${VAR:?required}` form so compose fails
  loudly if unset). `AUTH_MODE` fixed to `single-tenant`.
- Ports: the lite service must bind `127.0.0.1:3000:3000` only (never 0.0.0.0).
  Postgres/ClickHouse/Temporal expose NO host ports at all.
- Add a `cloudflared` service (image `cloudflare/cloudflared`, pinned tag),
  `command: tunnel --no-autoupdate run --token ${CLOUDFLARE_TUNNEL_TOKEN:?required}`,
  on the same network, restart always. It reaches the app at
  `http://lite:3000` inside the compose network (document that the tunnel's
  public hostname config maps email.tryamie.com -> http://lite:3000).
- Named volumes for postgres data, clickhouse data, temporal nothing (stateless,
  uses PG). Healthchecks on postgres (pg_isready), clickhouse (HTTP ping on
  8123), and lite (HTTP GET on 3000). `depends_on` with `condition:
  service_healthy` where the base file used bare depends_on.
- Logging: keep `driver: local` and add sane max-size/max-file options.
- `BOOTSTRAP` controlled by env `BOOTSTRAP=${BOOTSTRAP:-false}` and documented:
  set true for first boot only.
- `DASHBOARD_API_BASE` env-driven, defaulting to `https://email.tryamie.com`.

### 2. `deploy/.env.example`
Every required variable with a one-line comment; obviously fake placeholder
values. Include WORKSPACE_NAME=Amie.

### 3. `deploy/README.md`
Concise runbook, in this order: box prerequisites (docker + compose plugin),
first boot (env file, BOOTSTRAP=true once, then flip false and re-up), login
(single-tenant PASSWORD), upgrade procedure using the `admin-cli` profile from
upstream lite compose (include the admin-cli service in prod compose under a
`profiles: ["admin-cli"]` so it's not normally running), backup/restore (below),
and how the Cloudflare Tunnel fits (token created in CF dashboard; no inbound
ports open on the box). Note SES/SMTP sending is configured in the dashboard
after boot, not in these files.

### 4. `deploy/backup.sh` + `deploy/backup.timer` + `deploy/backup.service`
- `backup.sh`: pg_dump (via `docker compose exec -T postgres pg_dump`) of the
  app DB and a ClickHouse `BACKUP DATABASE ... TO` (or clickhouse-client native
  backup to a tar via `docker compose exec`; pick the simplest reliable method
  for the pinned CH version and say why in a comment), gzip both to
  `/var/backups/dittofeed/<utc-timestamp>/`, then `aws s3 sync` that dir to
  `s3://${BACKUP_S3_BUCKET}/dittofeed/` and prune local copies older than 7
  days. Fail loudly (set -euo pipefail), exit non-zero on any step failure.
- systemd `backup.service` (oneshot, runs backup.sh with EnvironmentFile
  /etc/dittofeed-backup.env) and `backup.timer` (daily 09:10 UTC).

## Hard fences
- WRITABLE: only new files under `deploy/`. Do NOT modify any existing repo
  file. No new npm dependencies. No commits.
- Validate your YAML: if the docker CLI is available run
  `docker compose -f deploy/docker-compose.prod.yaml config` with a stub env;
  otherwise parse each YAML with node (`js-yaml` is already in the repo's
  dependency tree — if not resolvable, write a tiny node script using a manual
  check that the files at least parse with `require('yaml')` if present, else
  skip and SAY SO in your final report).
- Final report: list every file created, the image tags you pinned, and exactly
  which validation you were able to run.
