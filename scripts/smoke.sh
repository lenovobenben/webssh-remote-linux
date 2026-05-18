#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export WEBSSH_REMOTE_ENV="${WEBSSH_REMOTE_ENV:-non-production}"
export WEBSSH_RUN_TIMEOUT_SECONDS="${WEBSSH_RUN_TIMEOUT_SECONDS:-10}"

echo "== doctor =="
"$script_dir/doctor.sh"

echo
echo "== clear mock/history =="
"$script_dir/send.sh" 'clear' >/dev/null

echo
echo "== read =="
"$script_dir/read.sh" 20

echo
echo "== send pwd =="
"$script_dir/send.sh" 'pwd'
"$script_dir/read.sh" 10

echo
echo "== run marker command =="
"$script_dir/run.sh" 'pwd; hostname; date'

echo
echo "== key ctrl-c =="
"$script_dir/key.sh" ctrl-c
"$script_dir/read.sh" 15

echo
echo "Smoke test completed."
