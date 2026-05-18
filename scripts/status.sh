#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/bridge.sh
source "$script_dir/bridge.sh"
# shellcheck source=scripts/log.sh
source "$script_dir/log.sh"

webssh_require_node

request_id="$(webssh_request_id)"

echo "Bridge URL: $(webssh_bridge_url)"
echo "Token file: $(webssh_bridge_token_file)"
echo

echo "Health:"
webssh_bridge_health | node -e '
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => raw += chunk);
process.stdin.on("end", () => {
  console.log(JSON.stringify(JSON.parse(raw || "{}"), null, 2));
});
'

echo
echo "Extension status:"
payload="$(webssh_json_payload status "$request_id" "" "")"
webssh_bridge_request "$payload" | node -e '
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => raw += chunk);
process.stdin.on("end", () => {
  console.log(JSON.stringify(JSON.parse(raw || "{}"), null, 2));
});
'
