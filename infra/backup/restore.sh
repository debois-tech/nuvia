#!/usr/bin/env bash
# Restore an encrypted backup into a SEPARATE database (never the live one).
#   infra/backup/restore.sh <nuvia-db-....dump.gpg> <target-database>
# Needs the offline private key in the current gpg keyring (or GNUPGHOME). To go live with a restored copy,
# see "Restoring for real" in docs/deployment.md.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${POSTGRES_USER:=nuvia}"
: "${POSTGRES_DB:=nuvia}"

file=${1:?usage: restore.sh <backup.dump.gpg> <target-database>}
target=${2:?usage: restore.sh <backup.dump.gpg> <target-database>}
[ -f "$file" ] || { echo "No such file: $file" >&2; exit 1; }
[[ "$target" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || { echo "Target database name must be lowercase letters, digits, underscore" >&2; exit 1; }
[ "$target" != "$POSTGRES_DB" ] || { echo "Refusing to overwrite the live database '$POSTGRES_DB'. Restore to another name first." >&2; exit 1; }

psql_admin() { docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres "$@"; }
psql_admin -qc "DROP DATABASE IF EXISTS $target WITH (FORCE)"
psql_admin -qc "CREATE DATABASE $target"
gpg --batch --quiet --decrypt "$file" \
  | docker compose exec -T db pg_restore -U "$POSTGRES_USER" -d "$target" --no-owner --no-acl --exit-on-error
echo "Restored $(basename "$file") into database '$target'."
