# webssh-remote-linux

Bridge local AI agents to already-authenticated enterprise WebSSH sessions.

## Background

Modern AI coding agents work extremely well on local terminals and standard SSH environments.

However, many enterprise production environments intentionally block direct SSH access and require users to:

- connect through VPN
- use SSO / MFA
- pass bastion hosts
- open browser-based WebSSH terminals
- operate inside audited enterprise environments

In these scenarios:

- humans can enter the shell
- AI agents usually cannot

This project exists to bridge that gap.

---

# What This Project Does

`webssh-remote-linux` attaches to an already-opened browser WebSSH session and exposes it to local AI workflows.

Typical workflow:

```text
Local AI Agent
(Codex / Claude / local LLM)
        ↓
webssh-remote-linux
        ↓
Browser WebSSH Session
(already authenticated by user)
        ↓
Enterprise Linux Server
```

## Documentation

- [Skill instructions](SKILL.md)
- [Install and smoke test guide (zh-CN)](docs/install.zh-CN.md)
- [Technical reference (zh-CN)](docs/reference.zh-CN.md)
- [Code architecture (zh-CN)](docs/architecture.zh-CN.md)

## Current Skeleton

The initial code layout contains:

- `extension/`: Chrome Manifest V3 extension.
- `native-host/`: Native Messaging host plus loopback bridge for local scripts.
- `scripts/`: stable `status.sh`, `probe.sh`, `read.sh`, `send.sh`, `key.sh`, `run.sh`, and `logs.sh` entrypoints for AI agents.

Install the native host after loading the unpacked extension:

```bash
native-host/install-host.sh <chrome-extension-id>
```

Uninstall the native host manifest:

```bash
native-host/uninstall-host.sh
```

Basic local checks after installing the extension and native host:

```bash
scripts/doctor.sh
scripts/smoke.sh
scripts/status.sh
export WEBSSH_REMOTE_ENV=non-production
scripts/read.sh 40
```

For extension smoke tests without a real WebSSH product, serve and open:

```bash
python3 -m http.server 18080
```

```text
http://127.0.0.1:18080/examples/mock-webssh.html
```
