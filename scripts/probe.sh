#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/bridge.sh
source "$script_dir/bridge.sh"
# shellcheck source=scripts/log.sh
source "$script_dir/log.sh"

webssh_require_node

request_id="$(webssh_request_id)"
payload="$(webssh_simple_payload probe "$request_id")"
webssh_bridge_request "$payload" | node -e '
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => raw += chunk);
process.stdin.on("end", () => {
  const payload = JSON.parse(raw || "{}");
  if (!payload.ok || payload.result?.ok === false) {
    console.error(payload.error || payload.result?.error || "probe failed");
    process.exit(1);
  }
  console.log(JSON.stringify(payload.result?.result || payload.result || {}, null, 2));
});
'
