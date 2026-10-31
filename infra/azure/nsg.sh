#!/usr/bin/env bash
# Azure network rules for Nuvia: the only thing reachable from the internet is the WireGuard UDP port.
# Needs the Azure CLI, signed in (az login) with rights on the resource group.
#
#   infra/azure/nsg.sh apply  <resource-group> <nsg-name>
#   infra/azure/nsg.sh check  <resource-group> <nsg-name>
#
#   WG_PORT             default 51820
#   WG_SOURCES          who may reach WireGuard, default "*" (the internet; WireGuard drops anything unauthenticated).
#                       Tighten to the office IPs if staff connect from fixed places.
#   ADMIN_SSH_CIDR      optional public address allowed to SSH, e.g. 203.0.113.7/32
#
# This script only ADDS rules and reports. It never deletes anything, because the VM may host other
# services. "check" lists every other inbound allow rule open to the internet so a person can decide.
set -euo pipefail
cmd=${1:?usage: nsg.sh apply|check <resource-group> <nsg-name>}
rg=${2:?resource group}
nsg=${3:?nsg name}
WG_PORT=${WG_PORT:-51820}
WG_SOURCES=${WG_SOURCES:-*}

check() {
  echo "Inbound ALLOW rules reachable from the internet (anything besides WireGuard needs a reason):"
  az network nsg rule list -g "$rg" --nsg-name "$nsg" \
    --query "[?direction=='Inbound' && access=='Allow' && (sourceAddressPrefix=='*' || sourceAddressPrefix=='Internet' || sourceAddressPrefix=='0.0.0.0/0')].{name:name,priority:priority,protocol:protocol,ports:destinationPortRange,ports2:destinationPortRanges[0]}" \
    -o table
  echo
  echo "Public IPs attached to the VM's network interface(s) are not covered by this check; confirm with infra/verify-exposure.sh from outside."
}

apply() {
  az network nsg rule create -g "$rg" --nsg-name "$nsg" -n Nuvia-Allow-WireGuard --priority 200 \
    --direction Inbound --access Allow --protocol Udp --source-address-prefixes $WG_SOURCES \
    --source-port-ranges '*' --destination-address-prefixes '*' --destination-port-ranges "$WG_PORT" \
    --description "Nuvia VPN endpoint. The only public port." -o none
  echo "Allowed UDP $WG_PORT from $WG_SOURCES"
  if [ -n "${ADMIN_SSH_CIDR:-}" ]; then
    az network nsg rule create -g "$rg" --nsg-name "$nsg" -n Nuvia-Allow-Admin-SSH --priority 210 \
      --direction Inbound --access Allow --protocol Tcp --source-address-prefixes "$ADMIN_SSH_CIDR" \
      --source-port-ranges '*' --destination-address-prefixes '*' --destination-port-ranges 22 \
      --description "Nuvia admin SSH from a fixed address" -o none
    echo "Allowed TCP 22 from $ADMIN_SSH_CIDR"
  fi
  echo "No rule was added for 80 or 443: Nuvia is served only on the VPN address."
  echo
  check
}

case "$cmd" in
  apply) apply ;;
  check) check ;;
  *) echo "usage: nsg.sh apply|check <resource-group> <nsg-name>" >&2; exit 2 ;;
esac
