#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$script_dir/.." && pwd)"
host_name="com.webssh_remote_linux.bridge"
extension_id="${1:-}"

if [ -z "$extension_id" ]; then
  cat >&2 <<'EOF'
usage: native-host/install-host.sh <chrome-extension-id>

Install the unpacked extension first, then copy its extension id from
chrome://extensions and pass it here.
EOF
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
  -e "s#\"path\": \".*\"#\"path\": \"$repo_dir/native-host/host.js\"#" \
  -e "s#chrome-extension://REPLACE_WITH_EXTENSION_ID/#chrome-extension://$extension_id/#" \
  "$script_dir/$host_name.json" > "$manifest_path"

chmod +x "$repo_dir/native-host/host.js"
echo "$manifest_path"
