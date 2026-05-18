# Code architecture

这是当前代码骨架的说明。目标是先把 WebSSH bridge 的关键边界落成可演进的目录结构，而不是一次性支持所有 WebSSH 产品。

## 目录布局

```text
webssh-remote-linux/
  extension/                  Chrome MV3 extension
    manifest.json
    src/
      background.js           service worker, Native Messaging and tab routing
      content.js              WebSSH page adapter
      popup.html              bind active WebSSH tab
      popup.js
      popup.css
  native-host/
    host.js                   Chrome Native Messaging host and loopback bridge
    install-host.sh           install user-level native host manifest
    com.webssh_remote_linux.bridge.json
  scripts/
    read.sh                   read recent terminal output
    send.sh                   send one command and Enter
    run.sh                    run one marker-wrapped command
    logs.sh                   query local JSONL logs
    env_guard.sh              environment and production confirmation guard
    bridge.sh                 localhost bridge HTTP helper
    log.sh                    JSONL audit helpers
  docs/
    reference.zh-CN.md
    architecture.zh-CN.md
```

## 通信链路

Chrome extension 不能直接被普通 shell script 调用，所以当前骨架采用这条链路：

```text
scripts/*.sh
  -> http://127.0.0.1:8765/request
  -> native-host/host.js
  -> Chrome Native Messaging stdio
  -> extension/src/background.js
  -> chrome.tabs.sendMessage
  -> extension/src/content.js
  -> WebSSH terminal DOM
```

`host.js` 是 Chrome 启动的 Native Messaging host。它同时启动一个只监听 `127.0.0.1` 的 HTTP bridge，给本地脚本使用。这个进程不保存远端凭据，也不直接连接远端服务器。

## Extension

`extension/manifest.json` 使用 Manifest V3。

`background.js` 负责：

- 连接 native host。
- 接收来自 native host 的 bridge request。
- 记录当前绑定的 WebSSH tab。
- 把 `read` / `send` 请求转发给 content script。

`content.js` 负责：

- 在当前页面里寻找 WebSSH 终端元素。
- 读取可见终端文本。
- 向终端输入元素派发文本和 Enter。

当前 content script 是通用骨架，只做启发式 DOM 识别。后续应该为具体 WebSSH 产品或 xterm.js 实例增加 adapter。

## Native host

`native-host/host.js` 同时做两件事：

- 按 Chrome Native Messaging 协议从 `stdin` / `stdout` 收发 JSON 消息。
- 在 `127.0.0.1:${WEBSSH_BRIDGE_PORT:-8765}` 暴露本地 HTTP 接口。

HTTP 接口目前只有：

- `GET /health`
- `POST /request`

`POST /request` 的请求体示例：

```json
{
  "action": "read",
  "request_id": "20260518-120000-12345",
  "lines": 40
}
```

```json
{
  "action": "send",
  "request_id": "20260518-120000-12345",
  "text": "pwd",
  "enter": true
}
```

## Scripts

脚本接口对齐 `tmux-remote-linux`：

```bash
export WEBSSH_REMOTE_ENV=non-production
scripts/read.sh 40
scripts/send.sh 'pwd'
scripts/run.sh 'pwd; hostname; date'
scripts/logs.sh last 10
```

生产环境必须显式选择：

```bash
export WEBSSH_REMOTE_ENV=production
```

在生产环境下，`send.sh` 和 `run.sh` 会要求确认。聊天 agent 使用时，应先在聊天里展示命令和一次性数字，再通过环境变量传给脚本：

```bash
WEBSSH_PROD_APPROVAL_EXPECTED_DIGIT=7
WEBSSH_PROD_APPROVAL_DIGIT=7
WEBSSH_COMMAND_EXPLANATION='读取当前目录和主机名'
scripts/run.sh 'pwd; hostname'
```

这些变量只能作为用户确认的转交，不允许 agent 自行设置来绕过审批。

## 下一步

最重要的后续工作：

- 增加具体 WebSSH/xterm.js adapter，不依赖通用 DOM 猜测。
- 增加 extension 页面里的显式 session 选择和状态展示。
- 让 `run.sh` 更可靠地轮询长命令，而不是只 sleep 一次。
- 增加 shellcheck、eslint 或最小测试。
- 完善 Native Messaging 安装文档和 Chrome extension 开发调试流程。
