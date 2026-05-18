#!/usr/bin/env bash

webssh_log_enabled() {
  [ "${WEBSSH_LOG_ENABLED:-1}" != "0" ]
}

webssh_log_dir() {
  printf '%s\n' "${WEBSSH_LOG_DIR:-$HOME/.codex/webssh-remote-linux/logs}"
}

webssh_log_now() {
  date '+%Y-%m-%dT%H:%M:%S%z'
}

webssh_log_epoch_ms() {
  printf '%s000\n' "$(date '+%s')"
}

webssh_request_id() {
  if [ -n "${WEBSSH_REQUEST_ID:-}" ]; then
    printf '%s\n' "$WEBSSH_REQUEST_ID"
    return 0
  fi

  printf '%s-%s\n' "$(date '+%Y%m%d-%H%M%S')" "$$"
}

webssh_json_string() {
  awk '
    BEGIN { printf "\"" }
    {
      if (NR > 1) printf "\\n"
      gsub(/\\/, "\\\\")
      gsub(/"/, "\\\"")
      gsub(/\t/, "\\t")
      gsub(/\r/, "\\r")
      printf "%s", $0
    }
    END { printf "\"" }
  '
}

webssh_log_append_json() {
  local json_line="$1"
  local log_dir log_file

  webssh_log_enabled || return 0

  log_dir="$(webssh_log_dir)"
  (umask 077 && mkdir -p "$log_dir") 2>/dev/null || return 0
  find "$log_dir" -type f -name '*.jsonl' -mtime +"${WEBSSH_LOG_RETENTION_DAYS:-7}" -delete 2>/dev/null || true
  log_file="$log_dir/$(date '+%Y-%m-%d').jsonl"
  (umask 077 && printf '%s\n' "$json_line" >> "$log_file") 2>/dev/null || true
}

webssh_log_run_event() {
  local request_id="$1"
  local command_text="$2"
  local status="$3"
  local started_at="$4"
  local ended_at="$5"
  local duration_ms="$6"
  local exit_code="$7"
  local output_text="$8"
  local command_json output_json request_id_json exit_code_json

  webssh_log_enabled || return 0

  request_id_json="$(printf '%s' "$request_id" | webssh_json_string)"
  command_json="$(printf '%s' "$command_text" | webssh_json_string)"
  output_json="$(printf '%s' "$output_text" | awk -v max="${WEBSSH_LOG_MAX_OUTPUT_LINES:-10}" 'NR <= max { print }' | webssh_json_string)"

  if [[ "$exit_code" =~ ^[0-9]+$ ]]; then
    exit_code_json="$exit_code"
  else
    exit_code_json="null"
  fi

  webssh_log_append_json "{\"schema_version\":1,\"tool\":\"webssh-remote-linux\",\"request_id\":$request_id_json,\"script\":\"run.sh\",\"env\":\"$WEBSSH_REMOTE_ENV\",\"status\":\"$status\",\"command\":$command_json,\"started_at\":\"$started_at\",\"ended_at\":\"$ended_at\",\"duration_ms\":$duration_ms,\"exit_code\":$exit_code_json,\"output\":{\"text\":$output_json}}"
}

webssh_log_send_event() {
  local request_id="$1"
  local command_text="$2"
  local command_json request_id_json

  webssh_log_enabled || return 0

  request_id_json="$(printf '%s' "$request_id" | webssh_json_string)"
  command_json="$(printf '%s' "$command_text" | webssh_json_string)"
  webssh_log_append_json "{\"schema_version\":1,\"tool\":\"webssh-remote-linux\",\"request_id\":$request_id_json,\"script\":\"send.sh\",\"env\":\"$WEBSSH_REMOTE_ENV\",\"status\":\"sent\",\"command\":$command_json,\"sent_at\":\"$(webssh_log_now)\",\"exit_code\":null,\"output\":null}"
}
