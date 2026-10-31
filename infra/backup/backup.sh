#!/usr/bin/env bash
# Encrypted backup of the Nuvia database (and the proxy's internal CA) to $BACKUP_DIR, optionally copied to a
# second Azure storage account. The backup is encrypted to a PUBLIC key, so the server cannot read its own
# backups; the private key lives offline and is needed only to restore.
#
#   BACKUP_GPG_PUBLIC_KEY_FILE   required. Exported public key (gpg --export --armor <id>)
#   BACKUP_DIR                   default: <repo>/backups
#   BACKUP_RETENTION_DAYS        default: 14 (local copies only)
#   BACKUP_OFFSITE_ACCOUNT / BACKUP_OFFSITE_CONTAINER   optional Azure storage account + container in another
#                                region/account the company owns. Uses `az` signed in with the VM's managed identity.
set -euo pipefail
umask 077

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
if [ -f .env ]; then set -a; . ./.env; set +a; fi

: "${BACKUP_GPG_PUBLIC_KEY_FILE:?set BACKUP_GPG_PUBLIC_KEY_FILE (exported public key)}"
: "${POSTGRES_USER:=nuvia}"
: "${POSTGRES_DB:=nuvia}"
: "${BACKUP_DIR:=$ROOT/backups}"
: "${BACKUP_RETENTION_DAYS:=14}"
mkdir -p "$BACKUP_DIR"

ts=$(date -u +%Y%m%dT%H%M%SZ)
gpg_home=$(mktemp -d)
trap 'rm -rf "$gpg_home"; rm -f "$BACKUP_DIR"/*.partial' EXIT
export GNUPGHOME="$gpg_home"
gpg --batch --quiet --import "$BACKUP_GPG_PUBLIC_KEY_FILE"
recipient=$(gpg --batch --list-keys --with-colons | awk -F: '/^fpr/ {print $10; exit}')
[ -n "$recipient" ] || { echo "No key found in $BACKUP_GPG_PUBLIC_KEY_FILE" >&2; exit 1; }
encrypt() { gpg --batch --yes --quiet --trust-model always --encrypt --recipient "$recipient" --output "$1"; }

db_file="$BACKUP_DIR/nuvia-db-$ts.dump.gpg"
ca_file="$BACKUP_DIR/nuvia-ca-$ts.tar.gpg"

echo "Dumping $POSTGRES_DB ..."
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl \
  | encrypt "$db_file.partial"
[ -s "$db_file.partial" ] || { echo "Backup is empty, refusing to keep it" >&2; exit 1; }
mv "$db_file.partial" "$db_file"

# The proxy's internal CA. Losing it means every staff device has to trust a new root.
docker compose exec -T proxy tar -C /data -cf - . | encrypt "$ca_file.partial"
[ -s "$ca_file.partial" ] && mv "$ca_file.partial" "$ca_file"

( cd "$BACKUP_DIR" && sha256sum "$(basename "$db_file")" "$(basename "$ca_file")" > "nuvia-$ts.sha256" )
echo "Wrote $db_file ($(du -h "$db_file" | cut -f1))"

if [ -n "${BACKUP_OFFSITE_ACCOUNT:-}" ] && [ -n "${BACKUP_OFFSITE_CONTAINER:-}" ]; then
  for f in "$db_file" "$ca_file" "$BACKUP_DIR/nuvia-$ts.sha256"; do
    az storage blob upload --auth-mode login --only-show-errors \
      --account-name "$BACKUP_OFFSITE_ACCOUNT" --container-name "$BACKUP_OFFSITE_CONTAINER" \
      --file "$f" --name "$(basename "$f")" >/dev/null
  done
  echo "Copied to $BACKUP_OFFSITE_ACCOUNT/$BACKUP_OFFSITE_CONTAINER"
else
  echo "WARNING: no offsite copy configured (BACKUP_OFFSITE_ACCOUNT / BACKUP_OFFSITE_CONTAINER). Local-only backups do not survive losing the VM." >&2
fi

find "$BACKUP_DIR" -maxdepth 1 -name 'nuvia-*' -type f -mtime +"$BACKUP_RETENTION_DAYS" -delete
echo "Done."
