#!/usr/bin/env bash
# Remove a device from the VPN (lost laptop, person left). Run as root on the VM.
#   remove-peer.sh <name>
set -euo pipefail
[ "${SKIP_ROOT_CHECK:-no}" = "yes" ] || [ "$(id -u)" -eq 0 ] || { echo "Run as root" >&2; exit 1; }
name=${1:?usage: remove-peer.sh <name>}
[[ "$name" =~ ^[A-Za-z0-9._-]{1,40}$ ]] || { echo "Name may use letters, digits, dot, dash, underscore" >&2; exit 1; }
WG_CONF=${WG_CONF:-/etc/wireguard/wg0.conf}
WG_IF=${WG_IF:-wg0}
PEERS_DIR=${PEERS_DIR:-$(cd "$(dirname "$0")" && pwd)/peers}

grep -q "^# peer: ${name}\$" "$WG_CONF" || { echo "No peer named '$name'" >&2; exit 1; }
pub=$(awk -v n="# peer: ${name}" '$0==n {f=1; next} f && /^PublicKey/ {sub(/^PublicKey = /,""); print; exit}' "$WG_CONF")

# Drop the "# peer:" line and everything up to the next blank line or next peer comment.
tmp=$(mktemp); trap 'rm -f "$tmp"' EXIT
awk -v n="# peer: ${name}" '
  $0==n {skip=1; next}
  skip && (/^$/ || /^# peer: /) {skip=0}
  !skip {print}
' "$WG_CONF" > "$tmp"
cat "$tmp" > "$WG_CONF"

if [ -n "$pub" ] && wg show "$WG_IF" >/dev/null 2>&1; then wg set "$WG_IF" peer "$pub" remove; fi
rm -f "${PEERS_DIR:?}/${name:?}.conf"
echo "Removed '${name}'. Their sessions in Nuvia stay valid until they expire: deactivate the user too if they have left."
