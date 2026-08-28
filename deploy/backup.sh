#!/usr/bin/env bash
set -euo pipefail

umask 077

: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
compose_file="${script_dir}/docker-compose.prod.yaml"
compose_env="${script_dir}/.env"
backup_root="/var/backups/dittofeed"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${backup_root}/${timestamp}"
clickhouse_archive="dittofeed-${timestamp}.tar"

if [[ ! -f "${compose_env}" ]]; then
  echo "Missing Compose environment file: ${compose_env}" >&2
  exit 1
fi

mkdir -p -- "${backup_dir}"

compose=(docker compose --env-file "${compose_env}" -f "${compose_file}")

"${compose[@]}" exec -T postgres sh -eu -c \
  'pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --no-owner --no-acl' \
  | gzip -9 > "${backup_dir}/postgres.sql.gz"

# ClickHouse 24.12 has a built-in, database-consistent BACKUP implementation.
# Writing its native tar to the configured local backup disk, then streaming it
# through gzip, is simpler and more reliable than scripting per-table exports.
"${compose[@]}" exec -T clickhouse-server sh -eu -c \
  'clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" --query "$1"' \
  sh "BACKUP DATABASE dittofeed TO Disk('backups', '${clickhouse_archive}')"

"${compose[@]}" exec -T clickhouse-server sh -eu -c \
  'cat "/backups/$1"' sh "${clickhouse_archive}" \
  | gzip -9 > "${backup_dir}/clickhouse.tar.gz"

"${compose[@]}" exec -T clickhouse-server sh -eu -c \
  'rm -f "/backups/$1"' sh "${clickhouse_archive}"

aws s3 sync "${backup_dir}/" "s3://${BACKUP_S3_BUCKET}/dittofeed/${timestamp}/"

find "${backup_root}" -mindepth 1 -maxdepth 1 -type d -mtime +7 \
  -exec rm -rf -- {} +
