#!/usr/bin/env bash
# Acceptance check for "VPN only, no public exposure".
#
#   infra/verify-exposure.sh public <vm-public-ip>
#       Run from OUTSIDE the VPN (home network, phone hotspot). Every listed TCP port must be closed or filtered.
#       Exit 0 = nothing exposed, 1 = something answered.
#   infra/verify-exposure.sh vpn <hostname> [ca-root.pem]
#       Run from a device ON the VPN. Nuvia must answer over HTTPS and report healthy.
#
#   PORTS    TCP ports to probe in public mode (default: common service ports plus the app's own)
set -uo pipefail
mode=${1:-}
target=${2:-}
[ -n "$mode" ] && [ -n "$target" ] || { sed -n '2,12p' "$0"; exit 2; }

case "$mode" in
  public)
    PORTS=${PORTS:-"22 80 443 3000 5432 8080 8443"}
    open=0
    for p in $PORTS; do
      if timeout 4 bash -c "exec 3<>/dev/tcp/$target/$p" 2>/dev/null; then
        echo "OPEN    tcp/$p   <-- reachable from outside"
        open=1
      else
        echo "closed  tcp/$p"
      fi
    done
    echo
    echo "Not checked: UDP. WireGuard (udp/51820) is meant to be open and does not answer unauthenticated packets."
    if [ "$open" -eq 0 ]; then echo "PASS: no probed TCP port is reachable from here."; exit 0; fi
    echo "FAIL: close the ports marked OPEN (Azure NSG first, then the host)."; exit 1
    ;;
  vpn)
    ca=${3:-}
    args=(-fsS --max-time 8)
    [ -n "$ca" ] && args+=(--cacert "$ca")
    body=$(curl "${args[@]}" "https://$target/health") || { echo "FAIL: https://$target/health did not answer (is the VPN up? does $target resolve to the server address?)"; exit 1; }
    echo "$body"
    echo "$body" | grep -q '"status":"ok"' && { echo "PASS: Nuvia is reachable over the VPN."; exit 0; }
    echo "FAIL: unexpected response"; exit 1
    ;;
  *) sed -n '2,12p' "$0"; exit 2 ;;
esac
