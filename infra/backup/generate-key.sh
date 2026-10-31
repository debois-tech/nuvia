#!/usr/bin/env bash
# Make the backup key pair. Run this on an ADMIN machine, not the server.
#   - backup-public.asc  goes on the server (it can encrypt but never decrypt)
#   - the private key stays offline (printed export path), plus a paper or vault copy
set -euo pipefail
out=${1:-.}
export GNUPGHOME=$(mktemp -d); trap 'rm -rf "$GNUPGHOME"' EXIT
gpg --batch --quiet --passphrase '' --quick-generate-key "Nuvia backups <backup@nuvia.internal>" rsa4096 encrypt never
fpr=$(gpg --batch --list-keys --with-colons | awk -F: '/^fpr/ {print $10; exit}')
gpg --armor --export "$fpr" > "$out/backup-public.asc"
( umask 077; gpg --batch --pinentry-mode loopback --passphrase '' --armor --export-secret-keys "$fpr" > "$out/backup-private.asc" )
echo "Public key:  $out/backup-public.asc  (copy to the server)"
echo "Private key: $out/backup-private.asc (store offline, then delete from this machine; it decrypts every backup)"
