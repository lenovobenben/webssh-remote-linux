#!/usr/bin/env bash

webssh_bridge_url() {
  printf '%s\n' "${WEBSSH_BRIDGE_URL:-http://127.0.0.1:${WEBSSH_BRIDGE_PORT:-8765}}"
}

webssh_require_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "node is required for JSON encoding/decoding" >&2
    exit 2
  fi
}

webssh_json_payload() {
  local action="$1"
  local request_id="$2"
  local text="${3:-}"
  local lines="${4:-}"

  ACTION="$action" REQUEST_ID="$request_id" TEXT_VALUE="$text" LINES_VALUE="$lines" node -e '
const payload = {
  action: process.env.ACTION,
  request_id: process.env.REQUEST_ID
};
if (process.env.TEXT_VALUE) payload.text = process.env.TEXT_VALUE;
if (process.env.LINES_VALUE) payload.lines = Number(process.env.LINES_VALUE);
process.stdout.write(JSON.stringify(payload));
'
}

webssh_bridge_request() {
  local payload="$1"
  local url
  url="$(webssh_bridge_url)"

  curl -fsS \
    -H 'content-type: application/json' \
    --data "$payload" \
    "$url/request"
}

webssh_response_ok() {
  node -e '
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => raw += chunk);
process.stdin.on("end", () => {
  const msg = JSON.parse(raw || "{}");
  if (msg.ok && (!msg.result || msg.result.ok !== false)) process.exit(0);
  console.error(msg.error || (msg.result && msg.result.error) || "bridge request failed");
  process.exit(1);
});
'
}

webssh_response_text() {
  node -e '
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => raw += chunk);
process.stdin.on("end", () => {
  const msg = JSON.parse(raw || "{}");
  const result = msg.result && msg.result.result ? msg.result.result : {};
  process.stdout.write(result.text || "");
});
'
}
