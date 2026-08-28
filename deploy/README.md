# Amie email platform production runbook

## Box prerequisites

Use a single Linux EC2 instance with the repository checked out at `/opt/dittofeed`. Install Docker Engine and the Docker Compose plugin so `docker compose version` succeeds. Backups also require the AWS CLI, systemd, an S3 bucket, and an instance role (preferred) or AWS credentials with permission to write that bucket. The instance needs outbound HTTPS access. Allow inbound TCP 443 only from Cloudflare's published IP ranges; do not expose port 3000.

Cloudflare must have a proxied DNS record for `email.tryamie.com` pointing to the box's public IP. The existing Let's Encrypt certificate and private key must be present on the box at `/etc/dittofeed/certs/fullchain.pem` and `/etc/dittofeed/certs/privkey.pem`, respectively, so Compose can mount them read-only into Caddy.

## First boot

1. Create the environment file and restrict it:

   ```bash
   cd /opt/dittofeed
   cp deploy/.env.example deploy/.env
   chmod 600 deploy/.env
   ```

2. Replace every fake secret and bucket value. Generate `SECRET_KEY` with `openssl rand -base64 32`. Leave `BOOTSTRAP=true` for this first start only.
3. Start the stack:

   ```bash
   docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yaml up -d
   docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yaml ps
   ```

4. Once `lite` is healthy and the workspace exists, set `BOOTSTRAP=false` in `deploy/.env` and re-create it:

   ```bash
   docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yaml up -d --force-recreate lite
   ```

Never turn bootstrap back on for normal restarts.

## Login

Open `https://email.tryamie.com`. Authentication is fixed to single-tenant mode; log in with the `PASSWORD` value from `deploy/.env`. Configure SES or another SMTP provider in the dashboard after boot—sending credentials do not belong in these deployment files.

## Upgrade

Keep `BOOTSTRAP=false`, take a backup, and read every intervening upstream upgrade guide before changing versions. The `admin-cli` service is behind the `admin-cli` profile and does not normally run.

For each target version, first pin `admin-cli.image` in `deploy/docker-compose.prod.yaml` to that target while `lite.image` remains on the old version. Start the profile and run the target guide's pre-upgrade command:

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yaml --profile admin-cli up -d admin-cli
docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yaml exec admin-cli ./admin.sh upgrade-X-Y-Z-pre
```

Then pin `lite.image` to the same target, re-create `lite`, run the guide's post-upgrade command, and stop the admin service:

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yaml up -d --force-recreate lite
docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yaml exec admin-cli ./admin.sh upgrade-X-Y-Z-post
docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yaml --profile admin-cli stop admin-cli
```

Use the exact pre/post command names in that version's upstream guide; some releases require additional steps.

## Backup and restore

`backup.sh` creates `/var/backups/dittofeed/<UTC timestamp>/postgres.sql.gz` and `clickhouse.tar.gz`, syncs them to `s3://$BACKUP_S3_BUCKET/dittofeed/<UTC timestamp>/`, and deletes local timestamp directories older than seven days. It uses PostgreSQL `pg_dump` and ClickHouse's consistent native `BACKUP DATABASE` implementation.

Install and enable the systemd units:

```bash
sudo install -m 0644 deploy/backup.service deploy/backup.timer /etc/systemd/system/
sudoedit /etc/dittofeed-backup.env
```

Put this in `/etc/dittofeed-backup.env`:

```text
BACKUP_S3_BUCKET=your-real-bucket-name
```

Then enable the daily 09:10 UTC schedule and test one backup:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now backup.timer
sudo systemctl start backup.service
sudo systemctl status backup.service
```

To restore, first sync one timestamped S3 directory to a protected local directory, stop `lite`, `caddy`, and `temporal`, and keep both database containers running:

```bash
mkdir -p /tmp/dittofeed-restore
aws s3 sync s3://YOUR_BUCKET/dittofeed/YYYYMMDDTHHMMSSZ/ /tmp/dittofeed-restore/
docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yaml stop lite caddy temporal
```

Restore PostgreSQL into a fresh `dittofeed` database:

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yaml exec -T postgres sh -c 'dropdb --username="$POSTGRES_USER" --if-exists --force "$POSTGRES_DB" && createdb --username="$POSTGRES_USER" "$POSTGRES_DB"'
gunzip -c /tmp/dittofeed-restore/postgres.sql.gz | docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yaml exec -T postgres sh -c 'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"'
```

Restore ClickHouse by copying the native tar to its configured backup disk, opening its authenticated client, and running the shown SQL:

```bash
gunzip -c /tmp/dittofeed-restore/clickhouse.tar.gz | docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yaml exec -T clickhouse-server sh -c 'cat > /backups/restore.tar'
docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yaml exec clickhouse-server sh -c 'clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD"'
```

```sql
DROP DATABASE IF EXISTS dittofeed SYNC;
RESTORE DATABASE dittofeed FROM Disk('backups', 'restore.tar');
```

Exit the client, remove `restore.tar`, and restart the stack:

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yaml exec -T clickhouse-server rm -f /backups/restore.tar
docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yaml up -d
```

Test restores regularly on a separate instance before relying on the backups.

## Cloudflare and Caddy edge

Cloudflare-proxied DNS sends `email.tryamie.com` to the box's public IP, and the EC2 security group restricts inbound port 443 to Cloudflare's IP ranges. Caddy terminates TLS on port 443 with `/etc/dittofeed/certs/fullchain.pem` and `/etc/dittofeed/certs/privkey.pem`, then proxies requests to `lite:3000` over the private Compose network. The `lite` port remains bound to `127.0.0.1:3000` for on-box diagnostics only.

The certificate is managed on the box by acme.sh rather than by Caddy. Its renewal hook must run `docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yaml restart caddy` from `/opt/dittofeed` so Caddy reloads the renewed certificate files.
