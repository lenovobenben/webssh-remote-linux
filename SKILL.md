---
name: webssh-remote-linux
description: Use this when the task requires operating, inspecting, testing, or diagnosing a remote Linux environment through a user-prepared browser WebSSH tab. Prefer this bridge over direct SSH when the user has opened an authenticated WebSSH session.
metadata:
  short-description: Read and write a browser WebSSH terminal
---

# webssh Remote Linux

Use the user's WebSSH bridge when the task is about operating a remote Linux terminal that the user has already opened in Chrome. The user owns browser login, VPN, SSO, MFA, bastion access, and sensitive prompts. The agent only reads and writes the selected WebSSH tab through this skill.

Reliability and safety are more important than broad terminal interactivity. This skill is for ordinary shell commands, not full-screen TUIs or REPL-style programs.

## Interface

Before any write operation, the user must explicitly choose the target environment:

```bash
export WEBSSH_REMOTE_ENV=production
# or
export WEBSSH_REMOTE_ENV=non-production
```

Do not infer this value. Ask the user if it is not already set or explicitly provided.

Scripts live in this skill directory:

```bash
scripts/status.sh
scripts/doctor.sh
scripts/smoke.sh
scripts/probe.sh
scripts/read.sh 40
scripts/send.sh '<command>'
scripts/key.sh enter
scripts/key.sh ctrl-c
scripts/run.sh '<command>'
scripts/logs.sh last 10
```

`status.sh` checks the native host, token file, extension connection, and bound browser tab.

`doctor.sh` runs a broader install and connectivity diagnosis. Use it when setup or bridge communication looks broken.

`smoke.sh` runs a bound-tab smoke test through `doctor`, `read`, `send`, `run`, and `key`. Use it after the user has bound a mock or real WebSSH tab.

`probe.sh` inspects the bound page and reports candidate terminal input/readable elements. Use it before adapting a new WebSSH product.

For noVNC/canvas consoles, `read.sh` may report that DOM text read is unavailable. Do not assume screen text can be read from these pages; use `probe.sh` first and avoid write tests unless the user explicitly approves. Do not use OCR as the default path.

For ttyd/xterm.js pages, canvas rendering can make DOM reads empty. This project can still read output when `probe.sh` reports `xterm.hasSocketCapture: true`; in that case the page hook is reading the terminal output stream before it is rendered.

`read.sh` reads recent terminal output from the bound WebSSH tab.

`send.sh` sends one command and presses Enter. Use it for commands that intentionally change shell state, such as `cd` or `export`, and commands expected to run for a long time.

`key.sh` sends a supported terminal key. Currently supported keys are `enter` and `ctrl-c`.

`run.sh` sends a marker-wrapped command, polls until the end marker appears or a timeout is reached, prints only the marker-scoped output, and exits with the remote command's status when available.

Useful environment variables:

```bash
WEBSSH_REMOTE_ENV=non-production
WEBSSH_BRIDGE_PORT=8765
WEBSSH_BRIDGE_URL=http://127.0.0.1:8765
WEBSSH_BRIDGE_TOKEN_FILE="$HOME/.codex/webssh-remote-linux/bridge-token.json"
WEBSSH_LINES=40
WEBSSH_RUN_TIMEOUT_SECONDS=30
WEBSSH_RUN_POLL_INTERVAL_SECONDS=1
WEBSSH_RUN_CAPTURE_LINES=400
WEBSSH_RUN_MAX_OUTPUT_LINES=200
WEBSSH_RUN_MAX_OUTPUT_BYTES=32768
WEBSSH_LOG_ENABLED=1
WEBSSH_LOG_DIR="$HOME/.codex/webssh-remote-linux/logs"
WEBSSH_LOG_MAX_OUTPUT_LINES=10
WEBSSH_REQUEST_ID=<optional-stable-id>
```

## Production Approval

In `production` mode, every `send.sh`, `key.sh`, or `run.sh` command must stop for explicit user confirmation before sending input to the browser WebSSH tab.

For Codex chat approval:

1. Generate a fresh random digit from `0` to `9`.
2. Show the user the target, environment, exact command or key, and a concise Chinese explanation.
3. Ask the user to reply with only that digit.
4. If the reply is not exactly the digit, do not execute.
5. After a matching reply, pass the approval through for that one command:

```bash
WEBSSH_REMOTE_ENV=production \
WEBSSH_PROD_APPROVAL_EXPECTED_DIGIT=<digit-shown-to-user> \
WEBSSH_PROD_APPROVAL_DIGIT=<digit-replied-by-user> \
WEBSSH_COMMAND_EXPLANATION='<Chinese explanation shown to the user>' \
scripts/run.sh '<command>'
```

Approval is per command. Do not reuse digits. Do not batch unrelated production commands under one approval.

Anti-bypass rule: Do not set `WEBSSH_PROD_APPROVAL_EXPECTED_DIGIT`, `WEBSSH_PROD_APPROVAL_DIGIT`, or `WEBSSH_COMMAND_EXPLANATION` unless the user explicitly replied with the approval digit in the current conversation.

## Operating Rules

- Start with `scripts/status.sh` and `scripts/read.sh` unless the user gave a precise command to run.
- Use `scripts/probe.sh` before changing selectors or adapting a new WebSSH page.
- Treat the WebSSH tab as shared state. Current host, user, cwd, foreground command, kubeconfig, and prompts matter.
- Prefer `run.sh` for short non-interactive inspection commands because it returns scoped output and exit code.
- Prefer `send.sh` for `cd`, `export`, long-running commands, or commands whose output will be observed separately.
- Use bounded reads. Do not dump unknown-size files or logs unless the user explicitly asks.
- Avoid `vim`, `nano`, `less`, `top`, `htop`, `watch`, MySQL shells, Redis shells, Python REPLs, Node REPLs, and similar interactive programs.
- If the terminal is inside a REPL, TUI, login prompt, password prompt, MFA prompt, or secret prompt, stop and ask the user to handle it in the browser.
- Never ask the user to paste passwords, MFA codes, tokens, private keys, or passphrases into chat.
- Do not attempt to read browser cookies, passwords, SSO tokens, or page data outside the terminal surface.
- Treat destructive or hard-to-reverse commands as requiring explicit user confirmation, even in non-production.
- For slow commands, wait and poll with bounded reads. Do not rush to `ctrl-c`.
- Only send `ctrl-c`, `kill`, `rm`, `kubectl delete`, service restarts, or similar disruptive commands when the user asks, clearly approves, or recovery is necessary and the impact is clear.

## If The WebSSH Terminal Is Not Ready

If `status.sh` or `read.sh` shows that the native host is unavailable, no tab is bound, or the tab is not a usable WebSSH terminal, tell the user to:

- install or reload the Chrome extension
- install the native host manifest with `native-host/install-host.sh <extension-id>`
- open and authenticate the WebSSH page themselves
- click the extension popup and choose `Bind Active Tab`
- handle any VPN, SSO, MFA, password, or secret prompt directly in the browser

Then run `status.sh` and `read.sh` again.

## Reporting

In the final answer, summarize the important remote output because the user may not see raw command output. Include:

- the bound tab or visible target context when available
- whether commands completed, timed out, or are still running
- key metrics, results, or errors
- any action that changed remote state

## Disclaimer

Use this skill at your own risk. The user is responsible for reviewing commands, understanding their impact, and deciding whether to run them. The project authors and contributors are not responsible for outages, data loss, security incidents, business impact, incident response cost, or third-party claims arising from use or misuse of this tool.
