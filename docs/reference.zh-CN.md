# webssh-remote-linux technical reference

这是 `webssh-remote-linux` 的早期技术说明。项目立意参考
`tmux-remote-linux`：让本地 AI agent 操作一个由用户自己准备好的远端
Linux 终端，但 transport 从本地 `tmux` pane 换成浏览器里的 WebSSH 页面。

前期目标不是做一个完整的远程终端平台，而是做一个很窄、可审计、可控的桥：

```text
Local AI Agent
  -> webssh-remote-linux scripts / local bridge
  -> Chrome extension
  -> already-authenticated WebSSH tab
  -> Enterprise Linux Server
```

用户负责打开 WebSSH、完成 VPN / SSO / MFA / 堡垒机登录、切换目录、选择环境变量和输入敏感信息。AI agent 只通过这个项目读取终端输出、发送普通 shell 命令，并汇总结果。

## 为什么需要这个项目

很多企业环境不允许从开发者机器直接 SSH 到目标服务器。用户通常只能通过浏览器 WebSSH 进入目标环境，而且登录过程可能包含 SSO、MFA、堡垒机、审计水印、会话录制或其他企业安全控制。

在这些场景里，AI agent 不应该也通常不能自己获取凭据或绕过企业认证链路。更合理的方式是：

- 用户自己完成浏览器 WebSSH 登录。
- 用户确认当前 WebSSH tab 连接的是正确目标。
- 本地 agent 只接管一个已经授权的终端通道。
- 所有 agent 写入都经过本地脚本、生产确认和审计日志。

这个项目的核心价值是把“人已经能操作的 WebSSH shell”变成一个 AI agent 可以安全读写的窄接口。

## 和 tmux-remote-linux 的关系

两个项目的上层语义应该保持一致：

- `read`：读取最近的终端输出。
- `send`：发送一条命令并按回车。
- `run`：发送一条带 begin/end marker 的短命令，只返回本次命令输出和退出码。
- `logs`：查询本地 JSONL 审计日志。
- `production` / `non-production`：使用前必须显式选择环境。
- 生产环境下，每一条写入命令都必须人工确认。

主要差异在底层 transport：

```text
tmux-remote-linux:
  scripts -> tmux capture-pane / send-keys -> SSH shell

webssh-remote-linux:
  scripts -> local bridge -> Chrome extension -> WebSSH terminal
```

因此，`webssh-remote-linux` 应该尽量复用 `tmux-remote-linux` 的操作协议、安全边界和脚本接口，只替换终端读写实现。

## 组件设计

### Skill 文档

`SKILL.md` 面向 Codex、Claude Code、Gemini CLI 等 AI 工具，描述什么时候使用这个桥、如何选择环境、如何读取和发送命令、生产环境如何确认，以及哪些场景必须停止交给用户处理。

Skill 文档是安全协议的一部分，不只是使用说明。它应该明确要求 agent 不直接尝试 SSH，不收集密码、MFA、token、私钥，也不在 WebSSH 里操作 REPL 或全屏 TUI。

### Shell scripts

脚本是本地 AI agent 的稳定入口。早期可以保持和 `tmux-remote-linux` 同名：

- `scripts/read.sh`
- `scripts/send.sh`
- `scripts/run.sh`
- `scripts/logs.sh`
- `scripts/env_guard.sh`
- `scripts/log.sh`

脚本不直接理解具体 WebSSH 产品。它们只和本地 bridge 通信，并负责环境检查、生产确认、输出截断、marker 解析和审计日志。

### Local bridge

Local bridge 连接 shell scripts 和 Chrome extension。它是本机进程，不保存远端凭据。

推荐优先评估 Chrome Native Messaging，因为它符合浏览器扩展和本机程序之间的标准通信模型。开发早期也可以使用 localhost HTTP 或 WebSocket bridge 快速验证，但需要明确绑定到本机、限制接口能力，并避免暴露给局域网。

Local bridge 的最小能力：

- 找到或绑定一个 WebSSH session。
- 从 extension 获取最近终端输出。
- 请求 extension 向终端注入文本或按键。
- 返回操作状态、错误和 request id。
- 写入或协助写入本地审计日志。

### Chrome extension

Chrome extension 运行在浏览器侧，负责识别 WebSSH 页面里的终端组件，并提供读写能力。

早期实现可以先支持常见的 xterm.js 类终端：

- 读取屏幕 buffer 或 DOM 文本。
- 向终端元素派发输入事件。
- 处理 Enter、Ctrl-C 等基本按键。
- 标识当前 tab、URL、title 和可见终端状态。

扩展不应该读取浏览器密码、cookie、SSO token 或页面里的非终端敏感数据。它只应该围绕用户明确选择的 WebSSH tab 工作。

## v0.1 范围

早期版本只需要证明这条链路可用：

1. 用户打开并登录 WebSSH。
2. 用户选择或绑定一个 WebSSH tab。
3. `read.sh` 能读取最近终端输出。
4. `send.sh` 能发送一条普通 shell 命令并回车。
5. `run.sh` 能用 marker 截取本次命令输出和退出码。
6. `production` 模式下发送命令前必须人工确认。
7. 本地 JSONL 日志记录每次 `send` / `run`。

暂不追求：

- 自动登录 WebSSH。
- 管理 SSH 凭据或堡垒机凭据。
- 支持所有厂商的 WebSSH 产品。
- 完整支持 REPL、vim、less、top、mysql、redis-cli 等高交互程序。
- 在一个命令里可靠控制多层嵌套 shell 或容器交互会话。

## 操作模型

一次典型操作流程：

1. 用户在 Chrome 中打开 WebSSH，完成登录和目标环境准备。
2. 用户告诉 agent 使用 `webssh-remote-linux`，并明确环境是 `production` 或 `non-production`。
3. agent 先执行 `read.sh`，确认当前终端状态。
4. 对短检查命令，agent 使用 `run.sh`。
5. 对改变当前 shell 状态或长时间运行的命令，agent 使用 `send.sh`，然后用 `read.sh` 观察结果。
6. 如果遇到密码、MFA、token 或其他敏感提示，agent 停止输入，由用户直接在浏览器里处理。
7. agent 汇总关键输出和采取过的动作。

## `run` 的基本协议

`run.sh` 应该像 `tmux-remote-linux` 一样发送一段包装命令：

- 打印唯一 begin marker。
- 执行用户命令。
- 保存退出码。
- 打印唯一 end marker 和退出码。

脚本读取终端输出后，只返回 begin/end marker 之间的内容，并把远端退出码映射成本地退出码。

这个协议可以避免把旧屏幕内容误认为本次命令结果，也方便审计日志记录结构化结果。

实现上应该按固定间隔轮询终端输出，直到看到 end marker 或达到超时。超时后返回 pending，并提示用户继续读取或等待。

## 安全边界

这个项目不应该成为认证绕过工具。必须坚持以下边界：

- 不保存 WebSSH 登录凭据。
- 不读取或导出浏览器 cookie、SSO token、密码管理器内容。
- 不替用户输入密码、MFA、token、私钥 passphrase。
- 不自动发现或扫描企业资产。
- 不在生产环境静默执行写入命令。
- 不承诺 REPL、TUI、全屏程序的稳定自动化。

生产环境模式下，任何通过 `send.sh` 或 `run.sh` 写入 WebSSH 的命令都必须经过用户明确确认。确认内容应包含目标、环境、完整命令、命令目的和一次性确认数字。

## 审计日志

本地日志建议沿用 `tmux-remote-linux` 的 JSONL 思路。每条记录至少包含：

- schema version
- tool name
- request id
- script name
- environment
- target tab/session 标识
- command
- started / ended time
- status
- exit code
- bounded output

日志默认保存在本机用户目录下，例如：

```text
~/.codex/webssh-remote-linux/logs/
```

输出必须做行数和字节数限制，避免把大量日志、敏感数据或整屏历史意外写入本地审计文件。

## 失败和降级

常见失败情况应清晰返回给 agent：

- 没有安装或启用 Chrome extension。
- 没有绑定 WebSSH tab。
- 当前 tab 不是可识别的 WebSSH 终端。
- 终端处于登录、密码、MFA、REPL 或 TUI 状态。
- `run` 的 begin marker 或 end marker 没有出现。
- 命令仍在运行，需要继续 `read` 观察。
- local bridge 不可用。

遇到无法判断的终端状态时，默认停止写入，让用户确认当前浏览器终端状态。

## 设计原则

- 用户拥有登录态，agent 只使用窄通道。
- 脚本接口稳定，transport 可以替换。
- 先保证可靠读写普通 shell，再考虑更多 WebSSH 适配。
- 所有输出都要有边界。
- 生产环境默认拒绝，确认后才执行。
- 对敏感输入和高交互程序保持保守。
