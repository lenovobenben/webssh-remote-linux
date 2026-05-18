#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$script_dir/.." && pwd)"
# shellcheck source=scripts/bridge.sh
source "$script_dir/bridge.sh"
# shellcheck source=scripts/log.sh
source "$script_dir/log.sh"

failures=0
warnings=0

ok() {
  printf '[ok] %s\n' "$1"
}

warn() {
  warnings=$((warnings + 1))
  printf '[warn] %s\n' "$1"
}

fail() {
  failures=$((failures + 1))
  printf '[fail] %s\n' "$1"
}

have_command() {
  command -v "$1" >/dev/null 2>&1
}

chrome_native_manifest_path() {
  case "$(uname -s)" in
    Darwin)
      printf '%s\n' "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.webssh_remote_linux.bridge.json"
      ;;
    Linux)
      printf '%s\n' "$HOME/.config/google-chrome/NativeMessagingHosts/com.webssh_remote_linux.bridge.json"
      ;;
    *)
      return 1
      ;;
  esac
}

check_dependencies() {
  echo "Dependencies:"

  if have_command node; then
    ok "node: $(node --version)"
  else
    fail "node is required"
  fi

  if have_command curl; then
    ok "curl found"
  else
    fail "curl is required"
  fi

  if have_command python3; then
    ok "python3 found for mock page serving"
  else
    warn "python3 not found; mock page server examples will need another HTTP server"
  fi
}

check_repo_files() {
  echo
  echo "Repository files:"

  for path in \
    "$repo_dir/extension/manifest.json" \
    "$repo_dir/extension/src/background.js" \
    "$repo_dir/extension/src/content.js" \
    "$repo_dir/native-host/host.js" \
    "$repo_dir/scripts/read.sh" \
    "$repo_dir/scripts/run.sh" \
    "$repo_dir/examples/mock-webssh.html"; do
    if [ -f "$path" ]; then
      ok "${path#$repo_dir/}"
    else
      fail "missing ${path#$repo_dir/}"
    fi
  done
}

check_native_manifest() {
  echo
  echo "Native Messaging manifest:"

  local manifest_path
  if ! manifest_path="$(chrome_native_manifest_path)"; then
    fail "unsupported OS for default Chrome native host path: $(uname -s)"
    return
  fi

  if [ ! -f "$manifest_path" ]; then
    fail "native host manifest not found: $manifest_path"
    echo "       run: native-host/install-host.sh <chrome-extension-id>"
    return
  fi

  ok "manifest exists: $manifest_path"

  MANIFEST_PATH="$manifest_path" REPO_DIR="$repo_dir" node -e '
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.env.MANIFEST_PATH, "utf8"));
if (manifest.name !== "com.webssh_remote_linux.bridge") {
  console.error(`unexpected native host name: ${manifest.name}`);
  process.exit(1);
}
if (!manifest.path || !fs.existsSync(manifest.path)) {
  console.error(`native host path missing or not found: ${manifest.path || ""}`);
  process.exit(1);
}
if (!Array.isArray(manifest.allowed_origins) || manifest.allowed_origins.length === 0) {
  console.error("allowed_origins is empty");
  process.exit(1);
}
console.log(`native host path: ${manifest.path}`);
console.log(`allowed origins: ${manifest.allowed_origins.join(", ")}`);
' | sed 's/^/       /' || fail "native host manifest is invalid"
}

check_token_file() {
  echo
  echo "Bridge token:"

  local token_file
  token_file="$(webssh_bridge_token_file)"
  if [ ! -f "$token_file" ]; then
    warn "token file not found: $token_file"
    echo "       Open or reload the Chrome extension so native-host/host.js starts."
    return
  fi

  ok "token file exists: $token_file"
  TOKEN_FILE="$token_file" node -e '
const fs = require("node:fs");
const payload = JSON.parse(fs.readFileSync(process.env.TOKEN_FILE, "utf8"));
if (!payload.token || !payload.port || !payload.pid) {
  console.error("token payload is missing token, port, or pid");
  process.exit(1);
}
console.log(`pid: ${payload.pid}`);
console.log(`port: ${payload.port}`);
' | sed 's/^/       /' || fail "token file is invalid"
}

check_bridge() {
  echo
  echo "Bridge health:"

  local health
  if ! health="$(webssh_bridge_health 2>/dev/null)"; then
    fail "bridge health is unavailable at $(webssh_bridge_url)"
    return
  fi

  printf '%s' "$health" | node -e '
let raw = "";
process.stdin.on("data", chunk => raw += chunk);
process.stdin.on("end", () => {
  const payload = JSON.parse(raw || "{}");
  if (!payload.ok) process.exit(1);
  console.log(`service: ${payload.service}`);
  console.log(`pid: ${payload.pid}`);
});
' | sed 's/^/       /' && ok "bridge health endpoint responded" || fail "bridge health response is invalid"
}

check_extension_status() {
  echo
  echo "Extension status:"

  local request_id payload response
  request_id="$(webssh_request_id)"
  payload="$(webssh_json_payload status "$request_id" "" "")"

  if ! response="$(webssh_bridge_request "$payload" 2>/dev/null)"; then
    fail "extension status request failed"
    return
  fi

  printf '%s' "$response" | node -e '
let raw = "";
process.stdin.on("data", chunk => raw += chunk);
process.stdin.on("end", () => {
  const payload = JSON.parse(raw || "{}");
  if (!payload.ok) {
    console.error(payload.error || "status response is not ok");
    process.exit(1);
  }
  const result = payload.result || {};
  console.log(`nativeHost: ${result.nativeHost}`);
  console.log(`boundTabId: ${result.boundTabId || "none"}`);
  if (result.tab) {
    console.log(`tab title: ${result.tab.title}`);
    console.log(`tab url: ${result.tab.url}`);
  }
});
' | sed 's/^/       /' && ok "extension status responded" || fail "extension status response is invalid"
}

check_optional_read() {
  echo
  echo "Optional read check:"

  if [ "${WEBSSH_DOCTOR_READ:-1}" = "0" ]; then
    warn "read check skipped because WEBSSH_DOCTOR_READ=0"
    return
  fi

  if ! WEBSSH_REMOTE_ENV="${WEBSSH_REMOTE_ENV:-non-production}" "$script_dir/read.sh" 5 >/tmp/webssh-doctor-read.out 2>/tmp/webssh-doctor-read.err; then
    warn "read check failed; bind a WebSSH tab with the extension popup"
    sed 's/^/       /' /tmp/webssh-doctor-read.err 2>/dev/null || true
    return
  fi

  ok "read check succeeded"
  sed 's/^/       /' /tmp/webssh-doctor-read.out | tail -n 8
}

check_dependencies
check_repo_files
check_native_manifest
check_token_file
check_bridge
check_extension_status
check_optional_read

echo
if [ "$failures" -gt 0 ]; then
  printf 'Doctor completed with %s failure(s) and %s warning(s).\n' "$failures" "$warnings"
  exit 1
fi

printf 'Doctor completed with 0 failures and %s warning(s).\n' "$warnings"
