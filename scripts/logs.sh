#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/log.sh
source "$script_dir/log.sh"

usage() {
  cat <<'EOF'
usage: logs.sh <command> [args]

Commands:
  path                    Print the active log directory.
  list                    List JSONL log files.
  last [N]                Show the last N events.
EOF
}

log_dir="$(webssh_log_dir)"
command_name="${1:-}"

case "$command_name" in
  path)
    printf '%s\n' "$log_dir"
    ;;
  list)
    [ -d "$log_dir" ] && find "$log_dir" -type f -name '*.jsonl' -print | sort
    ;;
  last)
    count="${2:-10}"
    [ -d "$log_dir" ] || exit 0
    find "$log_dir" -type f -name '*.jsonl' -print | sort | while IFS= read -r file; do
      cat "$file"
    done | tail -n "$count"
    ;;
  ""|-h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
