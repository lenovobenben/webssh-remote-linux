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
echo "== probe =="
"$script_dir/probe.sh" | node -e '
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => raw += chunk);
process.stdin.on("end", () => {
  const probe = JSON.parse(raw || "{}");
  console.log(`title: ${probe.title || ""}`);
  console.log(`url: ${probe.url || ""}`);
  console.log(`terminalInput: ${probe.terminalInput ? `${probe.terminalInput.tag}#${probe.terminalInput.id}.${probe.terminalInput.className}` : "none"}`);
  console.log(`readableRoot: ${probe.readableRoot ? `${probe.readableRoot.tag}#${probe.readableRoot.id}.${probe.readableRoot.className}` : "none"}`);
  console.log(`xterm: ${JSON.stringify(probe.xterm || {})}`);
});
'

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
