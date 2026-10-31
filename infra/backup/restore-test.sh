#!/usr/bin/env bash
# Proves a backup can actually be restored: restores the newest backup (or the one given) into a scratch
# database, checks the data and the audit hash chain, then drops the scratch database.
# Exits non-zero on any failure. Appends one line to $BACKUP_DIR/restore-test.log.
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${POSTGRES_USER:=nuvia}"
: "${BACKUP_DIR:=$ROOT/backups}"
scratch=nuvia_restore_test

file=${1:-$(ls -1t "$BACKUP_DIR"/nuvia-db-*.dump.gpg 2>/dev/null | head -n1)}
log() { echo "$(date -u +%FT%TZ) $*" | tee -a "$BACKUP_DIR/restore-test.log"; }
fail() { log "FAIL $(basename "${file:-none}"): $*"; exit 1; }
[ -n "${file:-}" ] && [ -f "$file" ] || fail "no backup found in $BACKUP_DIR"
cleanup() { docker compose exec -T db psql -U "$POSTGRES_USER" -d postgres -qc "DROP DATABASE IF EXISTS $scratch WITH (FORCE)" >/dev/null 2>&1; }
trap cleanup EXIT

"$ROOT/infra/backup/restore.sh" "$file" "$scratch" >/dev/null || fail "restore command failed"
q() { docker compose exec -T db psql -U "$POSTGRES_USER" -d "$scratch" -tAc "$1"; }

users=$(q "SELECT count(*) FROM users") || fail "users table missing"
[ "$users" -ge 1 ] || fail "restored database has no users"
admins=$(q "SELECT count(*) FROM users WHERE role='hr_admin' AND active") || fail "cannot read admins"
[ "$admins" -ge 1 ] || fail "restored database has no active HR/admin"
migs=$(q "SELECT count(*) FROM schema_migrations") || fail "schema_migrations missing"
expected=$(ls -1 "$ROOT"/backend/migrations/*.sql | wc -l)
[ "$migs" -eq "$expected" ] || fail "expected $expected migrations, found $migs"

chain=$(docker compose run --rm --no-deps -T \
  -e DATABASE_URL="postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@db:5432/$scratch" \
  app node dist/cli/verify-audit.js) || fail "audit hash chain is broken: $chain"
events=$(echo "$chain" | sed -n 's/.*"checked":\([0-9]*\).*/\1/p')
log "OK $(basename "$file"): $users users, $events audit events, chain verified"
