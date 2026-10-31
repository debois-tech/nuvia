#!/usr/bin/env bash
# Add a staff device to the VPN and write its client config. Run as root on the VM.
#   add-peer.sh <name> <client-ip>        e.g.  add-peer.sh asha-laptop 10.8.0.12
#   WG_ENDPOINT   required: public IP or DNS name of the VM
#   NUVIA_HOSTNAME / SERVER_IP   used for the hosts-file hint in the config (defaults nuvia.internal / 10.8.0.1)
# The config contains the device's private key. Hand it over securely, then delete it from the server.
set -euo pipefail
[ "${SKIP_ROOT_CHECK:-no}" = "yes" ] || [ "$(id -u)" -eq 0 ] || { echo "Run as root" >&2; exit 1; }
name=${1:?usage: add-peer.sh <name> <client-ip>}
ip=${2:?usage: add-peer.sh <name> <client-ip>}
[[ "$name" =~ ^[A-Za-z0-9._-]{1,40}$ ]] || { echo "Name may use letters, digits, dot, dash, underscore" >&2; exit 1; }
[[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || { echo "Client IP must be a plain IPv4 address" >&2; exit 1; }
: "${WG_ENDPOINT:?set WG_ENDPOINT to the public IP or DNS name of the VM}"

WG_CONF=${WG_CONF:-/etc/wireguard/wg0.conf}
WG_IF=${WG_IF:-wg0}
WG_PORT=${WG_PORT:-$(awk -F' *= *' '/^ListenPort/ {print $2}' "$WG_CONF")}
SERVER_IP=${SERVER_IP:-10.8.0.1}
NUVIA_HOSTNAME=${NUVIA_HOSTNAME:-nuvia.internal}
PEERS_DIR=${PEERS_DIR:-$(cd "$(dirname "$0")" && pwd)/peers}
SERVER_PUB=${SERVER_PUB:-$(cat /etc/wireguard/server.pub)}

grep -q "^# peer: ${name}\$" "$WG_CONF" && { echo "Peer '$name' already exists" >&2; exit 1; }
grep -q "^AllowedIPs = ${ip}/32\$" "$WG_CONF" && { echo "Address $ip is already assigned" >&2; exit 1; }
[ "$ip" != "$SERVER_IP" ] || { echo "$ip is the server's own address" >&2; exit 1; }

umask 077
mkdir -p "$PEERS_DIR"
priv=$(wg genkey); pub=$(echo "$priv" | wg pubkey); psk=$(wg genpsk)

cat >> "$WG_CONF" <<PEER

# peer: ${name}
[Peer]
PublicKey = ${pub}
PresharedKey = ${psk}
AllowedIPs = ${ip}/32
PEER
if wg show "$WG_IF" >/dev/null 2>&1; then
  wg set "$WG_IF" peer "$pub" preshared-key <(echo "$psk") allowed-ips "${ip}/32"
fi

out="$PEERS_DIR/${name}.conf"
cat > "$out" <<CLIENT
# Nuvia VPN for ${name}. After connecting, ${NUVIA_HOSTNAME} must resolve to ${SERVER_IP}:
#   add this line to the hosts file:   ${SERVER_IP}  ${NUVIA_HOSTNAME}
[Interface]
PrivateKey = ${priv}
Address = ${ip}/32

[Peer]
PublicKey = ${SERVER_PUB}
PresharedKey = ${psk}
Endpoint = ${WG_ENDPOINT}:${WG_PORT}
# Only Nuvia goes through the tunnel. Everything else on the device uses its normal connection.
AllowedIPs = ${SERVER_IP}/32
PersistentKeepalive = 25
CLIENT
echo "Added '${name}' (${ip}). Client config: ${out}"
command -v qrencode >/dev/null && qrencode -t ansiutf8 < "$out" || true
