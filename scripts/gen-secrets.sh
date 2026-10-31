#!/usr/bin/env bash
# Create .env from .env.example with fresh random secrets. Refuses to overwrite an existing .env.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -e .env ] && { echo ".env already exists; leaving it alone." >&2; exit 1; }
umask 077
pw=$(openssl rand -hex 24)
key=$(openssl rand -base64 32)
sed -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${pw}|" \
    -e "s|^APP_ENCRYPTION_KEY=.*|APP_ENCRYPTION_KEY=${key}|" .env.example > .env
echo "Wrote .env (mode 600). Review NUVIA_HOSTNAME and VPN_BIND_ADDR, then: docker compose up -d --build"
echo "Back up APP_ENCRYPTION_KEY somewhere safe and separate from the database backups."
