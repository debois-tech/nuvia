#!/usr/bin/env bash
# Install and start the WireGuard server on the Nuvia VM. Run as root on the VM.
#   WG_ADDRESS   server address inside the VPN        default 10.8.0.1/24
#   WG_PORT      UDP listen port                      default 51820
#   CONFIGURE_UFW=yes   also set host firewall rules (see below). Off by default because this is a shared VM.
#   ADMIN_SSH_CIDR      with CONFIGURE_UFW: public address allowed to SSH, e.g. 203.0.113.7/32 (optional)
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run as root" >&2; exit 1; }

WG_ADDRESS=${WG_ADDRESS:-10.8.0.1/24}
WG_PORT=${WG_PORT:-51820}
CONF=/etc/wireguard/wg0.conf

apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq wireguard qrencode

umask 077
mkdir -p /etc/wireguard
if [ ! -f /etc/wireguard/server.key ]; then
  wg genkey > /etc/wireguard/server.key
fi
wg pubkey < /etc/wireguard/server.key > /etc/wireguard/server.pub

if [ ! -f "$CONF" ]; then
  cat > "$CONF" <<CONFEOF
[Interface]
Address = ${WG_ADDRESS}
ListenPort = ${WG_PORT}
PrivateKey = $(cat /etc/wireguard/server.key)
# No forwarding and no NAT: VPN clients can reach this server only, not the internet through it and not each other.
CONFEOF
  echo "Wrote $CONF"
else
  echo "$CONF already exists; leaving it alone."
fi
systemctl enable --now wg-quick@wg0
echo "Server public key: $(cat /etc/wireguard/server.pub)"

if [ "${CONFIGURE_UFW:-no}" = "yes" ]; then
  echo "Ports listening on all interfaces right now (these become unreachable from outside if you continue):"
  ss -tulnH | awk '{print "  " $1, $5}'
  command -v ufw >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ufw
  if [ -n "${ADMIN_SSH_CIDR:-}" ]; then ufw allow from "$ADMIN_SSH_CIDR" to any port 22 proto tcp; fi
  ufw allow in on wg0 to any port 22 proto tcp
  ufw allow in on wg0 to any port 443 proto tcp
  ufw allow "${WG_PORT}/udp"
  ufw default deny incoming
  ufw default allow outgoing
  ufw --force enable
  echo "ufw is on. Docker publishes ports around ufw, so the real guards are the bind address in .env"
  echo "(VPN_BIND_ADDR) and the Azure network security group. Run infra/verify-exposure.sh from outside to confirm."
fi
