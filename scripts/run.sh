#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/env_guard.sh
source "$script_dir/env_guard.sh"
# shellcheck source=scripts/log.sh
source "$script_dir/log.sh"
# shellcheck source=scripts/bridge.sh
source "$script_dir/bridge.sh"

webssh_require_environment
webssh_require_node

if [ "$#" -lt 1 ]; then
  echo "usage: $0 '<command>'" >&2
  exit 2
fi

wait_seconds="${WEBSSH_RUN_WAIT_SECONDS:-1}"
capture_lines="${WEBSSH_RUN_CAPTURE_LINES:-400}"
max_output_lines="${WEBSSH_RUN_MAX_OUTPUT_LINES:-200}"

command_text="$1"
webssh_confirm_if_production "$command_text"

request_id="$(webssh_request_id)"
marker="WEBSSH_RUN_$(date +%s)_$$"
begin="__${marker}_BEGIN__"
end="__${marker}_END__"
started_at="$(webssh_log_now)"
started_ms="$(webssh_log_epoch_ms)"

encoded_command="$(printf '%s' "$command_text" | base64 | tr -d '\n')"
wrapped_command="printf '\\n%s\\n' '$begin'; printf '%s' '$encoded_command' | base64 -d | bash; __webssh_status=\$?; printf '\\n%s:%s\\n' '$end' \"\$__webssh_status\""

payload="$(webssh_json_payload send "$request_id" "$wrapped_command" "")"
response="$(webssh_bridge_request "$payload")"
printf '%s' "$response" | webssh_response_ok >/dev/null

sleep "$wait_seconds"

payload="$(webssh_json_payload read "$request_id-read" "" "$capture_lines")"
response="$(webssh_bridge_request "$payload")"
printf '%s' "$response" | webssh_response_ok >/dev/null
captured="$(printf '%s' "$response" | webssh_response_text)"

if ! printf '%s\n' "$captured" | grep -Fxq "$begin"; then
  ended_at="$(webssh_log_now)"
  ended_ms="$(webssh_log_epoch_ms)"
  webssh_log_run_event "$request_id" "$command_text" "begin_not_found" "$started_at" "$ended_at" "$((ended_ms - started_ms))" 124 ""
  echo "[run.sh] begin marker not found yet: $begin" >&2
  exit 124
fi

if ! printf '%s\n' "$captured" | grep -q "^${end}:"; then
  pending_output="$(printf '%s\n' "$captured" | awk -v begin="$begin" '$0 == begin { seen = 1; next } seen { print }' | tail -n "$max_output_lines")"
  [ -n "$pending_output" ] && printf '%s\n' "$pending_output"
  ended_at="$(webssh_log_now)"
  ended_ms="$(webssh_log_epoch_ms)"
  webssh_log_run_event "$request_id" "$command_text" "pending" "$started_at" "$ended_at" "$((ended_ms - started_ms))" 124 "$pending_output"
  echo "[run.sh] end marker not found yet; command may still be running" >&2
  exit 124
fi

command_output="$(printf '%s\n' "$captured" | awk -v begin="$begin" -v end="$end" '
  $0 == begin { seen = 1; next }
  seen && index($0, end ":") == 1 { done = 1; exit }
  seen { print }
')"
limited_output="$(printf '%s\n' "$command_output" | awk -v max="$max_output_lines" 'NR <= max { print }')"
[ -n "$limited_output" ] && printf '%s\n' "$limited_output"

remote_status="$(printf '%s\n' "$captured" | awk -v end="$end" 'index($0, end ":") == 1 { sub("^" end ":", ""); print; exit }')"
ended_at="$(webssh_log_now)"
ended_ms="$(webssh_log_epoch_ms)"

if [[ "$remote_status" =~ ^[0-9]+$ ]]; then
  echo "[request_id $request_id]"
  echo "[exit $remote_status]"
  webssh_log_run_event "$request_id" "$command_text" "completed" "$started_at" "$ended_at" "$((ended_ms - started_ms))" "$remote_status" "$command_output"
  exit "$remote_status"
fi

webssh_log_run_event "$request_id" "$command_text" "exit_parse_error" "$started_at" "$ended_at" "$((ended_ms - started_ms))" 1 "$command_output"
echo "[run.sh] unable to parse remote exit status" >&2
exit 1
