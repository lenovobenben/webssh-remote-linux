# 安装和本地冒烟测试

这份文档描述开发期最短安装路径。目标是先验证本机脚本、Chrome extension、Native Messaging host 和 mock WebSSH 页面之间的链路。

当前项目不是面向终端用户的开箱即用产品。它尚未在真实企业级 WebSSH 产品中验证；如果要用于自己的 WebSSH 页面，通常需要阅读代码并二次开发 adapter。

## 前置条件

本机需要：

- Chrome
- Node.js
- `bash`
- `curl`
- `python3`，用于启动 mock 页面 HTTP server

确认：

```bash
node --version
curl --version
python3 --version
```

## 1. 加载 Chrome extension

打开：

```text
chrome://extensions
```

开启右上角 Developer mode，然后点击 `Load unpacked`，选择仓库里的：

```text
/Users/lihaidong/code/webssh-remote-linux/extension
```

加载后复制这个扩展的 Extension ID。

建议把扩展固定到工具栏，方便后续点击 popup。

## 2. 安装 Native Messaging host

把上一步复制的 Extension ID 传给安装脚本：

```bash
native-host/install-host.sh <extension-id>
```

脚本会校验 extension id 格式、写入 Native Messaging manifest，并打印后续操作提示。
manifest 会指向 `native-host/host-wrapper.sh`。这个 wrapper 会显式设置 Node.js 常见路径，避免 Chrome GUI 环境找不到 `node`。

macOS 上 manifest 会写到：

```text
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.webssh_remote_linux.bridge.json
```

安装后回到 `chrome://extensions`，点击 `webssh-remote-linux` 的 reload。

## 3. 启动 mock WebSSH 页面

在仓库根目录启动 HTTP server：

```bash
python3 -m http.server 18080
```

打开：

```text
http://127.0.0.1:18080/examples/mock-webssh.html
```

点击工具栏里的 `webssh-remote-linux` 扩展图标，然后点击 `Bind Active Tab`。

绑定成功时 popup 会显示：

```json
{
  "ok": true,
  "result": {
    "nativeHost": "connected",
    "boundTabId": "...",
    "tab": {
      "title": "Mock WebSSH Terminal"
    }
  }
}
```

这个 mock 使用 DOM 文本，主要验证基本绑定、读写和 marker run。

如果要验证 canvas/WebSocket 场景，另开一个本地 fixture：

```bash
node examples/mock-websocket-server.js
```

打开：

```text
http://127.0.0.1:18081/
```

这个 fixture 模拟“页面把终端画到 canvas，DOM 中没有可读文本，但浏览器侧能捕获 WebSocket PTY 输出流”。它只是本地回归测试工具，不是项目的服务端部署方式。

绑定后运行：

```bash
export WEBSSH_REMOTE_ENV=non-production
scripts/probe.sh
scripts/run.sh 'pwd; hostname; echo fixture-ok'
```

`probe.sh` 应看到：

```json
{
  "readMode": "websocket-stream",
  "readable": true
}
```

## 4. 运行诊断

```bash
scripts/doctor.sh
```

正常情况下最后应看到：

```text
Doctor completed with 0 failures and 0 warning(s).
```

如果 read 检查失败，通常是没有绑定 tab、扩展刚 reload 后页面还没刷新，或者 native host 没有启动。重新打开 mock 页面并点击 `Bind Active Tab`。

## 5. 运行冒烟测试

先声明非生产环境：

```bash
export WEBSSH_REMOTE_ENV=non-production
```

运行：

```bash
scripts/smoke.sh
```

冒烟测试会执行：

- `scripts/doctor.sh`
- `scripts/probe.sh`
- `scripts/read.sh`
- `scripts/send.sh 'pwd'`
- `scripts/run.sh 'pwd; hostname; date'`
- `scripts/key.sh ctrl-c`

## 常见问题

### Could not establish connection. Receiving end does not exist.

这通常表示当前 tab 里没有可用 content script。处理方式：

1. 回到 `chrome://extensions` reload 扩展。
2. 刷新 mock WebSSH 页面。
3. 再次点击扩展 popup 里的 `Bind Active Tab`。

当前代码会在发送消息失败时尝试自动注入 content script，但扩展 reload 后重新绑定仍然是更稳妥的操作。

### Bridge token file not found

说明 native host 还没有启动。确认：

- Native Messaging manifest 已安装。
- Chrome extension 已 reload。
- popup 中 `nativeHost` 显示 `connected`。

token 文件默认路径：

```text
~/.codex/webssh-remote-linux/bridge-token.json
```

### POST /request 返回 401

说明脚本带的 token 和 native host 当前 token 不一致。通常是 native host 重启后 token 文件过期或脚本读取了错误路径。重新 reload 扩展，然后再运行：

```bash
scripts/doctor.sh
```

### `run.sh` 超时

`run.sh` 会轮询直到看到 end marker。mock 页面正常情况下很快返回。如果真实 WebSSH 命令较慢，可以临时调大：

```bash
WEBSSH_RUN_TIMEOUT_SECONDS=120 scripts/run.sh '<command>'
```

### Vultr noVNC 只能读到 `no VNC`

Vultr Web Console 是 noVNC canvas 控制台。终端文字画在 canvas 上，DOM 中没有可直接读取的终端文本。`probe.sh` 应该能识别 `adapter: novnc`，但 `read.sh` 会提示 DOM text read 不可用。

这种页面可以先测试输入 adapter；读屏能力需要额外方案，例如 noVNC framebuffer hook。不要把 OCR 当成默认方案。

### ttyd 页面能输入但 `read.sh` 为空

ttyd/xterm.js 可能用 canvas renderer，DOM 中没有 `.xterm-rows` 文本。当前实现依赖 `src/page-hook.js` 在页面创建 WebSocket 前注入。

处理方式：

1. 回到 `chrome://extensions` reload 扩展。
2. 刷新 ttyd 页面。
3. 再次点击扩展 popup 里的 `Bind Active Tab`。
4. 运行：

```bash
export WEBSSH_REMOTE_ENV=non-production
scripts/probe.sh
scripts/read.sh 40
```

如果 `probe.sh` 返回 `xterm.hasSocketCapture: true`，说明已经捕获到服务端 PTY 输出流，可以继续使用：

```bash
scripts/run.sh 'pwd; hostname; df -h'
```

## 卸载

只移除 Chrome Native Messaging manifest：

```bash
native-host/uninstall-host.sh
```

同时移除本地 bridge token 和日志目录：

```bash
native-host/uninstall-host.sh --state
```

卸载后建议在 `chrome://extensions` 中 reload 或移除 `webssh-remote-linux` 扩展。
