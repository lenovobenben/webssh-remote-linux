#!/usr/bin/env bash
set -euo pipefail

host_name="com.webssh_remote_linux.bridge"
remove_state=0

usage() {
  cat <<'EOF'
usage: native-host/uninstall-host.sh [--state]

Remove the Chrome Native Messaging host manifest for webssh-remote-linux.

Options:
  --state    Also remove local bridge token state under ~/.codex/webssh-remote-linux.

Audit logs are not removed by default.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --state)
      remove_state=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
done

case "$(uname -s)" in
  Darwin)
    manifest_path="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/$host_name.json"
    ;;
  Linux)
    manifest_path="$HOME/.config/google-chrome/NativeMessagingHosts/$host_name.json"
    ;;
  *)
    echo "unsupported OS: $(uname -s)" >&2
    exit 2
    ;;
esac

if [ -f "$manifest_path" ]; then
  rm -f "$manifest_path"
  echo "Removed native host manifest:"
  echo "  $manifest_path"
else
  echo "Native host manifest was not installed:"
  echo "  $manifest_path"
fi

if [ "$remove_state" = "1" ]; then
  state_dir="$HOME/.codex/webssh-remote-linux"
  if [ -d "$state_dir" ]; then
    rm -rf "$state_dir"
    echo "Removed local state:"
    echo "  $state_dir"
  else
    echo "Local state directory was not present:"
    echo "  $state_dir"
  fi
else
  cat <<'EOF'

Local state was left in place. To remove the bridge token and logs too, run:
  native-host/uninstall-host.sh --state
EOF
fi

cat <<'EOF'

Next steps:
  1. Reload or remove the extension in chrome://extensions
  2. Close any Chrome tabs using the bridge
EOF
