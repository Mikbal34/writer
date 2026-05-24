#!/usr/bin/env bash
# Daily Postgres backup → Cloudflare R2. Run via cron on the VM.
#
# Cron entry (sudo crontab -e):
#   15 3 * * * /opt/quilpen/scripts/deploy/backup-db.sh >> /var/log/quilpen-backup.log 2>&1
#
# Keeps the last 7 daily backups in R2 under db-backups/. Older ones
# are pruned automatically. R2 storage cost: ~$0.015/GB/month → 7 ×
# ~50 MB compressed dump ≈ $0.005/month for the whole rotation.

set -euo pipefail

cd /opt/quilpen

# Read specific vars without sourcing (some values contain shell metacharacters)
read_env() {
	grep -E "^${1}=" .env | head -1 | sed "s/^${1}=//" | sed 's/^"//;s/"$//'
}
R2_ACCESS_KEY_ID=$(read_env R2_ACCESS_KEY_ID)
R2_SECRET_ACCESS_KEY=$(read_env R2_SECRET_ACCESS_KEY)
R2_ACCOUNT_ID=$(read_env R2_ACCOUNT_ID)
R2_BUCKET=$(read_env R2_BUCKET)

STAMP=$(date -u +%Y%m%d_%H%M%S)
DUMP_FILE="/tmp/quilpen-db-${STAMP}.dump"
R2_KEY="db-backups/quilpen-db-${STAMP}.dump"

echo "[$(date -Iseconds)] pg_dump start"
docker compose -f docker-compose.prod.yml exec -T postgres \
	pg_dump --format=custom --no-owner --no-privileges -U quilpen quilpen > "$DUMP_FILE"

SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo "[$(date -Iseconds)] pg_dump done, size=$SIZE"

echo "[$(date -Iseconds)] upload to R2"
# AWS CLI talks to R2 via S3 API
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
aws s3 cp "$DUMP_FILE" "s3://${R2_BUCKET}/${R2_KEY}" \
	--endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
	--no-progress

echo "[$(date -Iseconds)] prune backups older than 7 days"
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
aws s3 ls "s3://${R2_BUCKET}/db-backups/" \
	--endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
	| awk -v cutoff="$(date -u -d '7 days ago' +%Y-%m-%d)" '$1 < cutoff { print $4 }' \
	| while read -r key; do
		[ -z "$key" ] && continue
		echo "  pruning $key"
		AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
		AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
		aws s3 rm "s3://${R2_BUCKET}/db-backups/${key}" \
			--endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
	done

rm -f "$DUMP_FILE"
echo "[$(date -Iseconds)] backup complete"
