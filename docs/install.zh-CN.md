# 安装和本地冒烟测试

这份文档描述开发期最短安装路径。目标是先验证本机脚本、Chrome extension、Native Messaging host 和 mock WebSSH 页面之间的链路。

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
