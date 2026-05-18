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
  echo "usage: $0 '<command>'" >&2
  exit 2
fi

command_text="$1"
webssh_confirm_if_production "$command_text"

request_id="$(webssh_request_id)"
payload="$(webssh_json_payload send "$request_id" "$command_text" "")"
response="$(webssh_bridge_request "$payload")"
printf '%s' "$response" | webssh_response_ok >/dev/null
webssh_log_send_event "$request_id" "$command_text"
echo "[request_id $request_id]"
