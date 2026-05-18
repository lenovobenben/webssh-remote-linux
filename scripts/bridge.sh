#!/usr/bin/env bash

webssh_bridge_url() {
  printf '%s\n' "${WEBSSH_BRIDGE_URL:-http://127.0.0.1:${WEBSSH_BRIDGE_PORT:-8765}}"
}

webssh_bridge_token_file() {
  printf '%s\n' "${WEBSSH_BRIDGE_TOKEN_FILE:-$HOME/.codex/webssh-remote-linux/bridge-token.json}"
}

webssh_require_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "node is required for JSON encoding/decoding" >&2
    exit 2
  fi
}

webssh_bridge_token() {
  if [ -n "${WEBSSH_BRIDGE_TOKEN:-}" ]; then
    printf '%s\n' "$WEBSSH_BRIDGE_TOKEN"
    return 0
  fi

  local token_file
  token_file="$(webssh_bridge_token_file)"
  if [ ! -f "$token_file" ]; then
    cat >&2 <<EOF
Bridge token file not found: $token_file

Start Chrome with the webssh-remote-linux extension installed and make sure the
native host is connected, or set WEBSSH_BRIDGE_TOKEN manually for development.
EOF
    exit 7
  fi

  TOKEN_FILE="$token_file" node -e '
const fs = require("node:fs");
const tokenFile = process.env.TOKEN_FILE;
const payload = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
if (!payload.token) {
  console.error(`token missing in ${tokenFile}`);
  process.exit(1);
}
process.stdout.write(payload.token);
'
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

webssh_key_payload() {
  local request_id="$1"
  local key="$2"

  REQUEST_ID="$request_id" KEY_VALUE="$key" node -e '
const payload = {
  action: "key",
  request_id: process.env.REQUEST_ID,
  key: process.env.KEY_VALUE
};
process.stdout.write(JSON.stringify(payload));
'
}

webssh_simple_payload() {
  local action="$1"
  local request_id="$2"

  ACTION="$action" REQUEST_ID="$request_id" node -e '
const payload = {
  action: process.env.ACTION,
  request_id: process.env.REQUEST_ID
};
process.stdout.write(JSON.stringify(payload));
'
}

webssh_bridge_request() {
  local payload="$1"
  local url token
  url="$(webssh_bridge_url)"
  token="$(webssh_bridge_token)"

  curl -fsS \
    -H 'content-type: application/json' \
    -H "x-webssh-bridge-token: $token" \
    --data "$payload" \
    "$url/request"
}

webssh_bridge_health() {
  local url
  url="$(webssh_bridge_url)"
  curl -fsS "$url/health"
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
