#!/usr/bin/env bash

webssh_require_environment() {
  case "${WEBSSH_REMOTE_ENV:-}" in
    production|non-production)
      return 0
      ;;
    "")
      cat >&2 <<'EOF'
WEBSSH_REMOTE_ENV is required before using this tool.

Choose one explicitly:
  export WEBSSH_REMOTE_ENV=production
  export WEBSSH_REMOTE_ENV=non-production

Production mode requires explicit confirmation for each command before it is sent.
EOF
      exit 3
      ;;
    *)
      cat >&2 <<EOF
Invalid WEBSSH_REMOTE_ENV: ${WEBSSH_REMOTE_ENV}

Allowed values:
  production
  non-production
EOF
      exit 3
      ;;
  esac
}

webssh_random_digit() {
  local byte
  byte="$(od -An -N1 -tu1 /dev/urandom 2>/dev/null | tr -d ' ')"
  if [[ "$byte" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$((byte % 10))"
    return 0
  fi

  awk 'BEGIN { srand(); print int(rand() * 10) }'
}

webssh_validate_digit() {
  [[ "$1" =~ ^[0-9]$ ]]
}

webssh_confirm_from_environment() {
  local expected="${WEBSSH_PROD_APPROVAL_EXPECTED_DIGIT:-}"
  local actual="${WEBSSH_PROD_APPROVAL_DIGIT:-}"
  local explanation="${WEBSSH_COMMAND_EXPLANATION:-}"

  webssh_validate_digit "$expected" || return 1
  webssh_validate_digit "$actual" || return 1
  [ "$expected" = "$actual" ] || return 1
  [ -n "$explanation" ] || return 1
}

webssh_confirm_if_production() {
  local command_text="$1"
  local explanation="${2:-${WEBSSH_COMMAND_EXPLANATION:-}}"

  if [ "${WEBSSH_REMOTE_ENV}" != "production" ]; then
    return 0
  fi

  if webssh_confirm_from_environment; then
    return 0
  fi

  cat >&2 <<'EOF'
!!! You are about to let an AI-assisted workflow operate on a production WebSSH session.
!!! Review the command, target browser tab, and current shell context yourself before continuing.
!!! You are responsible for the result.

EOF

  if [ ! -t 0 ]; then
    cat >&2 <<'EOF'
Production command requires explicit confirmation.

For chat-agent use, approve the exact command in chat first. The agent may then
pass a one-time digit approval through:
  WEBSSH_PROD_APPROVAL_EXPECTED_DIGIT
  WEBSSH_PROD_APPROVAL_DIGIT
  WEBSSH_COMMAND_EXPLANATION
EOF
    exit 4
  fi

  local digit confirmation
  digit="$(webssh_random_digit)"

  cat >&2 <<EOF
PRODUCTION WEBSSH COMMAND CONFIRMATION

Explanation:
${explanation:-No explanation provided. Review the command carefully.}

Command:
${command_text}

EOF

  printf 'Type %s to send this command: ' "$digit" >&2
  IFS= read -r confirmation

  if [ "$confirmation" != "$digit" ]; then
    echo "Command was not sent." >&2
    exit 4
  fi
}
