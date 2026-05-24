#!/usr/bin/env bash
# One-shot Neon → local Postgres migration. Runs on the VM, talks to
# both DBs over the private docker network. ~5-10 min for 161k chunks.
#
# Steps:
#   1. pg_dump from Neon (currently DATABASE_URL in .env)
#   2. CREATE EXTENSION vector on local DB (so types resolve at restore)
#   3. pg_restore into local postgres container
#   4. Verify row counts match
#   5. Print the new DATABASE_URL to switch to
#
# Run: sudo bash /opt/quilpen/scripts/deploy/migrate-neon-to-local.sh

set -euo pipefail

cd /opt/quilpen

# Read specific vars from .env without sourcing (sourcing breaks on
# values containing `<` `>` `|` like EMAIL_FROM="Quilpen <x@y.com>").
read_env() {
	local key="$1"
	grep -E "^${key}=" .env | head -1 | sed "s/^${key}=//" | sed 's/^"//;s/"$//'
}

NEON_URL=$(read_env DATABASE_URL)
POSTGRES_PASSWORD=$(read_env POSTGRES_PASSWORD)
R2_ACCESS_KEY_ID=$(read_env R2_ACCESS_KEY_ID)
R2_SECRET_ACCESS_KEY=$(read_env R2_SECRET_ACCESS_KEY)
R2_ACCOUNT_ID=$(read_env R2_ACCOUNT_ID)
R2_BUCKET=$(read_env R2_BUCKET)

if [ -z "$NEON_URL" ] || [ -z "$POSTGRES_PASSWORD" ]; then
	echo "ERROR: DATABASE_URL or POSTGRES_PASSWORD missing from .env"
	exit 1
fi

LOCAL_URL="postgresql://quilpen:${POSTGRES_PASSWORD}@postgres:5432/quilpen"
DUMP_FILE="/tmp/quilpen-neon-dump-$(date -u +%Y%m%d_%H%M%S).dump"

echo "==> [1/5] Preparing local DB (pgvector extension)"
docker compose -f docker-compose.prod.yml exec -T postgres \
	psql -U quilpen -d quilpen -c "CREATE EXTENSION IF NOT EXISTS vector;"

echo "==> [2/5] pg_dump from Neon (this is the slow step, ~3-5 min for vector data)"
# Use the pgvector image's pg_dump (PG17 client) to ensure version compat
docker compose -f docker-compose.prod.yml exec -T -e PGPASSWORD=dummy postgres \
	pg_dump --format=custom --no-owner --no-privileges --no-acl \
	--exclude-schema=cron --exclude-schema=neon \
	"$NEON_URL" > "$DUMP_FILE"
SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo "    dump complete, size=$SIZE at $DUMP_FILE"

echo "==> [3/5] pg_restore into local postgres"
docker compose -f docker-compose.prod.yml exec -T postgres \
	pg_restore --no-owner --no-privileges --no-acl --disable-triggers \
	-d "$LOCAL_URL" < "$DUMP_FILE" 2>&1 | tail -20 || true

echo "==> [4/5] Verify row counts"
for table in LibraryEntry LibraryChunk LibraryEntryVolume User Project; do
	NEON_COUNT=$(docker compose -f docker-compose.prod.yml exec -T postgres \
		psql -qAtX "$NEON_URL" -c "SELECT COUNT(*) FROM \"$table\"" 2>/dev/null || echo "ERR")
	LOCAL_COUNT=$(docker compose -f docker-compose.prod.yml exec -T postgres \
		psql -qAtX "$LOCAL_URL" -c "SELECT COUNT(*) FROM \"$table\"" 2>/dev/null || echo "ERR")
	if [ "$NEON_COUNT" = "$LOCAL_COUNT" ]; then
		echo "    ✓ $table: $LOCAL_COUNT rows match"
	else
		echo "    ✗ $table: NEON=$NEON_COUNT LOCAL=$LOCAL_COUNT — MISMATCH"
	fi
done

echo "==> [5/5] Cleanup dump file"
rm -f "$DUMP_FILE"

echo ""
echo "================================================================"
echo "Migration complete. To switch the app to local Postgres:"
echo ""
echo "  1. Edit /opt/quilpen/.env — replace DATABASE_URL with:"
echo "     postgresql://quilpen:<POSTGRES_PASSWORD>@postgres:5432/quilpen"
echo "     (the NEON_URL is still in there as backup — save it elsewhere)"
echo ""
echo "  2. sudo docker compose -f docker-compose.prod.yml restart web worker"
echo ""
echo "  3. Test: open https://quilpen.com, login, upload a tiny PDF."
echo ""
echo "  4. After 24h stable: shut down Neon Launch tier in Neon console."
echo "================================================================"
