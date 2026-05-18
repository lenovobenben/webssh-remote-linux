#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/env_guard.sh
source "$script_dir/env_guard.sh"
# shellcheck source=scripts/log.sh
source "$script_dir/log.sh"
# shellcheck source=scripts/bridge.sh
source "$script_dir/bridge.sh"

webssh_require_environment
webssh_require_node

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <enter|ctrl-c>" >&2
  exit 2
fi

key_name="$1"
case "$key_name" in
  enter|ctrl-c|ctrl+c)
    ;;
  *)
    echo "unsupported key: $key_name" >&2
    echo "usage: $0 <enter|ctrl-c>" >&2
    exit 2
    ;;
esac

webssh_confirm_if_production "send key: $key_name"

request_id="$(webssh_request_id)"
payload="$(webssh_key_payload "$request_id" "$key_name")"
response="$(webssh_bridge_request "$payload")"
printf '%s' "$response" | webssh_response_ok >/dev/null
webssh_log_send_event "$request_id" "key:$key_name"
echo "[request_id $request_id]"
