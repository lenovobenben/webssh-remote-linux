(function installWebsshRemoteLinuxPageHook() {
  if (window.__WEBSSH_REMOTE_LINUX_HOOK__) {
    return;
  }

  const state = {
    terminals: [],
    socketChunks: []
  };

  const textDecoder = new TextDecoder("utf-8", { fatal: false });

  function rememberSocketText(text) {
    const cleaned = cleanTerminalText(extractTerminalOutput(String(text || "")));
    if (!cleaned) {
      return;
    }
    state.socketChunks.push(cleaned);
    if (state.socketChunks.length > 400) {
      state.socketChunks.splice(0, state.socketChunks.length - 400);
    }
  }

  function extractTerminalOutput(text) {
    if (!text) {
      return "";
    }

    const firstCode = text.charCodeAt(0);
    if (firstCode >= 0 && firstCode <= 5) {
      return firstCode === 0 ? text.slice(1) : "";
    }

    if (/^[0-5](?:\x1b|\r|\n|[\x20-\x7e])/.test(text)) {
      return text[0] === "0" ? text.slice(1) : "";
    }

    return text;
  }

  function cleanTerminalText(text) {
    return String(text || "")
      .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "")
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/\x1b[()][A-Za-z0-9]/g, "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  }

  function readSocketText(lines) {
    const text = state.socketChunks.join("");
    const allLines = text.split("\n");
    const requested = Number.isInteger(lines) && lines > 0 ? lines : 40;
    return allLines.slice(-requested).join("\n");
  }

  function captureSocketMessage(data) {
    if (typeof data === "string") {
      rememberSocketText(data);
      return;
    }

    if (data instanceof ArrayBuffer) {
      rememberSocketText(textDecoder.decode(new Uint8Array(data)));
      return;
    }

    if (ArrayBuffer.isView(data)) {
      rememberSocketText(textDecoder.decode(data));
      return;
    }

    if (data instanceof Blob) {
      data.arrayBuffer()
        .then((buffer) => rememberSocketText(textDecoder.decode(new Uint8Array(buffer))))
        .catch(() => {});
    }
  }

  function patchWebSocket() {
    const OriginalWebSocket = window.WebSocket;
    if (!OriginalWebSocket || OriginalWebSocket.__websshPatched) {
      return;
    }

    const WrappedWebSocket = function wrappedWebSocket(...args) {
      const socket = new OriginalWebSocket(...args);
      socket.addEventListener("message", (event) => captureSocketMessage(event.data));
      return socket;
    };

    WrappedWebSocket.prototype = OriginalWebSocket.prototype;
    Object.setPrototypeOf(WrappedWebSocket, OriginalWebSocket);
    Object.defineProperty(WrappedWebSocket, "__websshPatched", {
      value: true,
      configurable: false
    });

    window.WebSocket = WrappedWebSocket;
  }

  function rememberTerminal(candidate) {
    if (!candidate || typeof candidate !== "object") {
      return;
    }
    if (!candidate._core?.buffer?.active || typeof candidate._core.buffer.active.getLine !== "function") {
      return;
    }
    if (!state.terminals.includes(candidate)) {
      state.terminals.push(candidate);
    }
  }

  function patchTerminalClass(TerminalClass) {
    if (!TerminalClass || !TerminalClass.prototype || TerminalClass.prototype.__websshPatched) {
      return;
    }

    for (const method of ["open", "write", "writeln", "paste", "focus"]) {
      const original = TerminalClass.prototype[method];
      if (typeof original !== "function") {
        continue;
      }
      TerminalClass.prototype[method] = function patchedTerminalMethod(...args) {
        rememberTerminal(this);
        return original.apply(this, args);
      };
    }

    Object.defineProperty(TerminalClass.prototype, "__websshPatched", {
      value: true,
      configurable: false
    });
  }

  function scanObject(root, depth, seen) {
    if (!root || (typeof root !== "object" && typeof root !== "function") || seen.has(root) || depth > 4) {
      return;
    }
    seen.add(root);
    rememberTerminal(root);

    if (root.Terminal) {
      patchTerminalClass(root.Terminal);
    }

    let keys = [];
    try {
      keys = Object.keys(root).slice(0, 300);
    } catch (_) {
      return;
    }

    for (const key of keys) {
      if (!/(term|xterm|terminal|tty|app|client|core|socket|window|addon|fit|webgl|canvas)/i.test(key)) {
        continue;
      }
      try {
        scanObject(root[key], depth + 1, seen);
      } catch (_) {
        // Ignore hostile getters.
      }
    }
  }

  function scanDomExpandoProperties() {
    for (const element of document.querySelectorAll(".xterm, .terminal, .xterm-screen, textarea, canvas")) {
      scanObject(element, 0, new Set());
    }
  }

  function scan() {
    if (window.Terminal) {
      patchTerminalClass(window.Terminal);
    }
    scanObject(window, 0, new Set());
    scanDomExpandoProperties();
  }

  function readBuffer(lines) {
    scan();
    const terminal = state.terminals[state.terminals.length - 1];
    const active = terminal?._core?.buffer?.active;
    if (!active || typeof active.getLine !== "function") {
      return {
        found: false,
        terminalCount: state.terminals.length,
        text: ""
      };
    }

    const requested = Number.isInteger(lines) && lines > 0 ? lines : 40;
    const baseY = Number(active.baseY || 0);
    const cursorY = Number(active.cursorY || 0);
    const end = baseY + cursorY;
    const start = Math.max(0, end - requested + 1);
    const output = [];

    for (let index = start; index <= end; index++) {
      const line = active.getLine(index);
      if (line) {
        output.push(line.translateToString(true));
      }
    }

    return {
      found: true,
      terminalCount: state.terminals.length,
      text: output.join("\n"),
      baseY,
      cursorY,
      rows: Number(terminal.rows || 0),
      cols: Number(terminal.cols || 0)
    };
  }

  window.__WEBSSH_REMOTE_LINUX_HOOK__ = {
    scan,
    readBuffer,
    readSocketText,
    stats() {
      scan();
      return {
        terminalCount: state.terminals.length,
        socketChunkCount: state.socketChunks.length,
        socketTextSample: readSocketText(5).slice(-500)
      };
    }
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.source !== "webssh-remote-linux-content") {
      return;
    }

    const request = event.data;
    try {
      if (request.type === "read-xterm-buffer") {
        const buffer = readBuffer(request.lines);
        if (!buffer.found) {
          buffer.socketText = readSocketText(request.lines);
          buffer.socketChunkCount = state.socketChunks.length;
        }
        window.postMessage({
          source: "webssh-remote-linux-page",
          id: request.id,
          ok: true,
          result: buffer
        }, "*");
      }

      if (request.type === "hook-stats") {
        window.postMessage({
          source: "webssh-remote-linux-page",
          id: request.id,
          ok: true,
          result: window.__WEBSSH_REMOTE_LINUX_HOOK__.stats()
        }, "*");
      }
    } catch (error) {
      window.postMessage({
        source: "webssh-remote-linux-page",
        id: request.id,
        ok: false,
        error: String(error && error.message ? error.message : error)
      }, "*");
    }
  });

  patchWebSocket();
  scan();
})();
