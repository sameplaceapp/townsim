#!/bin/sh
# Launch on a private interface without opening the service on public interfaces.
set -eu

first_private_ipv4() {
  awk -F. '
    NF == 4 {
      valid = 1
      for (i = 1; i <= 4; i++) {
        if ($i !~ /^[0-9]+$/ || $i < 0 || $i > 255 || sprintf("%d", $i) != $i) valid = 0
      }
      if (valid && ($1 == 10 || ($1 == 172 && $2 >= 16 && $2 <= 31) || ($1 == 192 && $2 == 168))) {
        print $0; exit
      }
    }'
}

bind_address=${WILLOWBROOK_BIND_ADDRESS:-}
default_interface_found=0
if [ -z "$bind_address" ] && command -v ip >/dev/null 2>&1; then
  interface=$(ip -4 route show default 2>/dev/null | awk 'NR == 1 { for (i = 1; i <= NF; i++) if ($i == "dev") { print $(i + 1); exit } }')
  if [ -n "$interface" ]; then
    default_interface_found=1
    bind_address=$(ip -o -4 addr show dev "$interface" scope global 2>/dev/null | awk '{ for (i = 1; i <= NF; i++) if ($i == "inet") { split($(i + 1), a, "/"); print a[1] } }' | first_private_ipv4)
  fi
fi
# macOS exposes its default interface through route and ipconfig.
if [ -z "$bind_address" ] && [ "$default_interface_found" -eq 0 ] && command -v route >/dev/null 2>&1 && command -v ipconfig >/dev/null 2>&1; then
  interface=$(route -n get default 2>/dev/null | awk '/interface:/ { print $2; exit }')
  if [ -n "$interface" ]; then
    default_interface_found=1
    bind_address=$(ipconfig getifaddr "$interface" 2>/dev/null | first_private_ipv4)
  fi
fi
if [ -z "$bind_address" ] && [ "$default_interface_found" -eq 0 ]; then
  bind_address=$(hostname -I 2>/dev/null | tr ' ' '\n' | first_private_ipv4)
fi
if [ -z "$bind_address" ] || [ "$(printf '%s\n' "$bind_address" | first_private_ipv4)" != "$bind_address" ]; then
  echo 'No private IPv4 address found. Set WILLOWBROOK_BIND_ADDRESS to a private address on this machine and retry.' >&2
  exit 1
fi

export WILLOWBROOK_BIND_ADDRESS="$bind_address"
printf 'Willowbrook will be available on this private address: http://%s:3000\n' "$bind_address"
exec docker compose up -d --build "$@"
