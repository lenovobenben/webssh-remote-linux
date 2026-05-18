#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/env_guard.sh
source "$script_dir/env_guard.sh"
# shellcheck source=scripts/bridge.sh
source "$script_dir/bridge.sh"

webssh_require_environment
webssh_require_node

lines="${1:-${WEBSSH_LINES:-40}}"
if ! [[ "$lines" =~ ^[0-9]+$ ]] || [ "$lines" -le 0 ]; then
  echo "usage: $0 [positive-line-count]" >&2
  exit 2
fi

request_id="$(webssh_request_id 2>/dev/null || printf '%s-%s\n' "$(date '+%Y%m%d-%H%M%S')" "$$")"
payload="$(webssh_json_payload read "$request_id" "" "$lines")"
response="$(webssh_bridge_request "$payload")"
printf '%s' "$response" | webssh_response_ok >/dev/null
printf '%s' "$response" | webssh_response_text
printf '\n'
