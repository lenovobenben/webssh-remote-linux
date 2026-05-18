#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$script_dir/.." && pwd)"
host_name="com.webssh_remote_linux.bridge"
extension_id="${1:-}"
host_script_path="$repo_dir/native-host/host.js"
host_path="$repo_dir/native-host/host-wrapper.sh"

if [ -z "$extension_id" ]; then
  cat >&2 <<'EOF'
usage: native-host/install-host.sh <chrome-extension-id>

Install the unpacked extension first, then copy its extension id from
chrome://extensions and pass it here.
EOF
  exit 2
fi

if ! [[ "$extension_id" =~ ^[a-p]{32}$ ]]; then
  cat >&2 <<EOF
Invalid Chrome extension id: $extension_id

Expected a 32-character lowercase id copied from chrome://extensions.
EOF
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required by native-host/host.js" >&2
  exit 2
fi

if [ ! -f "$host_script_path" ]; then
  echo "native host script not found: $host_script_path" >&2
  exit 2
fi

if [ ! -f "$host_path" ]; then
  echo "native host wrapper not found: $host_path" >&2
  exit 2
fi

case "$(uname -s)" in
  Darwin)
    manifest_dir="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    ;;
  Linux)
    manifest_dir="$HOME/.config/google-chrome/NativeMessagingHosts"
    ;;
  *)
    echo "unsupported OS: $(uname -s)" >&2
    exit 2
    ;;
esac

mkdir -p "$manifest_dir"
manifest_path="$manifest_dir/$host_name.json"

sed \
  -e "s#\"path\": \".*\"#\"path\": \"$host_path\"#" \
  -e "s#chrome-extension://REPLACE_WITH_EXTENSION_ID/#chrome-extension://$extension_id/#" \
  "$script_dir/$host_name.json" > "$manifest_path"

chmod +x "$host_script_path" "$host_path"
MANIFEST_PATH="$manifest_path" HOST_PATH="$host_path" EXTENSION_ID="$extension_id" node -e '
const fs = require("node:fs");
const manifestPath = process.env.MANIFEST_PATH;
const hostPath = process.env.HOST_PATH;
const extensionId = process.env.EXTENSION_ID;
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

if (manifest.name !== "com.webssh_remote_linux.bridge") {
  throw new Error(`unexpected native host name: ${manifest.name}`);
}
if (manifest.path !== hostPath) {
  throw new Error(`unexpected native host path: ${manifest.path}`);
}
if (!manifest.allowed_origins.includes(`chrome-extension://${extensionId}/`)) {
  throw new Error("allowed_origins does not include the extension id");
}
'

cat <<EOF
Installed Chrome Native Messaging host:
  $manifest_path

Native host:
  $host_path

Allowed extension:
  chrome-extension://$extension_id/

Next steps:
  1. Reload the webssh-remote-linux extension in chrome://extensions
  2. Open a WebSSH or mock terminal tab
  3. Click the extension icon and choose "Bind Active Tab"
  4. Run: scripts/doctor.sh
EOF
