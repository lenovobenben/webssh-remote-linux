let injectedHook = false;
let hookRequestId = 1;
const hookRequests = new Map();

function ensurePageHook() {
  if (injectedHook) {
    return;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.source !== "webssh-remote-linux-page") {
      return;
    }

    const pending = hookRequests.get(event.data.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    hookRequests.delete(event.data.id);

    if (event.data.ok) {
      pending.resolve(event.data.result);
    } else {
      pending.reject(new Error(event.data.error || "page hook request failed"));
    }
  });

  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("src/page-hook.js");
  script.onload = () => script.remove();
  script.onerror = () => script.remove();
  (document.documentElement || document.head || document.body).appendChild(script);
  injectedHook = true;
}

function requestPageHook(type, payload = {}) {
  ensurePageHook();
  const id = `hook-${Date.now()}-${hookRequestId++}`;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      hookRequests.delete(id);
      reject(new Error("timed out waiting for page hook response"));
    }, 1000);

    hookRequests.set(id, { resolve, reject, timer });
    window.postMessage({
      source: "webssh-remote-linux-content",
      id,
      type,
      ...payload
    }, "*");
  });
}

function findTerminalElement() {
  const selectors = [
    "#noVNC_keyboardinput",
    ".xterm-helper-textarea",
    ".xterm textarea",
    "textarea[aria-label*='Terminal' i]",
    "textarea",
    "[contenteditable='true']"
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      return element;
    }
  }

  return null;
}

function detectAdapter() {
  if (document.querySelector("#noVNC_keyboardinput") || document.querySelector("#noVNC_canvas") || document.title.includes("noVNC")) {
    return "novnc";
  }

  if (document.querySelector(".xterm") || document.querySelector(".xterm-helper-textarea") || document.querySelector(".xterm-rows")) {
    return "xterm-dom";
  }

  return "generic-dom";
}

function findNoVncKeyboardInput() {
  return document.querySelector("#noVNC_keyboardinput");
}

function findNoVncCanvas() {
  return document.querySelector("#noVNC_canvas") || document.querySelector("canvas");
}

function describeElement(element) {
  if (!element) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  return {
    tag: element.tagName.toLowerCase(),
    id: element.id || "",
    className: normalizeClassName(element.className),
    ariaLabel: element.getAttribute("aria-label") || "",
    role: element.getAttribute("role") || "",
    contentEditable: element.getAttribute("contenteditable") || "",
    visible: Boolean(rect.width || rect.height),
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    },
    textSample: String(element.innerText || element.value || "").slice(0, 120)
  };
}

function normalizeClassName(className) {
  if (typeof className === "string") {
    return className;
  }

  if (className && typeof className.baseVal === "string") {
    return className.baseVal;
  }

  return "";
}

function queryCandidates(selectors, limit) {
  const results = [];
  const seen = new Set();

  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      if (seen.has(element)) {
        continue;
      }
      seen.add(element);
      results.push({
        selector,
        element: describeElement(element)
      });
      if (results.length >= limit) {
        return results;
      }
    }
  }

  return results;
}

function findTerminalContainer() {
  if (detectAdapter() === "novnc") {
    return findNoVncKeyboardInput() || findNoVncCanvas() || document.activeElement || document.body;
  }

  const input = findTerminalElement();
  return input?.closest(".xterm") || input?.closest(".terminal") || input || document.activeElement || document.body;
}

function findReadableTerminalRoot() {
  const selectors = [
    ".xterm-screen",
    ".xterm-rows",
    ".terminal",
    "pre",
    "body"
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element && element.innerText) {
      return element;
    }
  }

  return document.body;
}

function readDomText(lines) {
  const root = findReadableTerminalRoot();
  const text = (root && root.innerText ? root.innerText : "").replace(/\r/g, "");
  const allLines = text.split("\n");
  const requested = Number.isInteger(lines) && lines > 0 ? lines : 40;
  return {
    text: allLines.slice(-requested).join("\n"),
    lines: Math.min(requested, allLines.length),
    source: root ? root.tagName.toLowerCase() : null,
    readMode: "dom-text"
  };
}

function findXtermObject() {
  const candidates = [];
  const seen = new Set();

  function visit(value, depth) {
    if (!value || (typeof value !== "object" && typeof value !== "function") || seen.has(value) || depth > 2) {
      return;
    }
    seen.add(value);

    if (value._core?.buffer?.active && typeof value._core.buffer.active.getLine === "function") {
      candidates.push(value);
      return;
    }

    const keys = [];
    try {
      keys.push(...Object.keys(value).slice(0, 80));
    } catch (_) {
      return;
    }

    for (const key of keys) {
      if (!/(term|xterm|terminal|tty|pty|socket|app|client|core)/i.test(key)) {
        continue;
      }
      try {
        visit(value[key], depth + 1);
      } catch (_) {
        // Ignore hostile getters.
      }
    }
  }

  visit(window, 0);
  return candidates[0] || null;
}

async function readXterm(lines) {
  const terminal = findXtermObject();
  const active = terminal?._core?.buffer?.active;
  if (active && typeof active.getLine === "function") {
    const requested = Number.isInteger(lines) && lines > 0 ? lines : 40;
    const baseY = Number(active.baseY || 0);
    const cursorY = Number(active.cursorY || 0);
    const end = baseY + cursorY;
    const start = Math.max(0, end - requested + 1);
    const output = [];

    for (let index = start; index <= end; index++) {
      const line = active.getLine(index);
      if (!line) {
        continue;
      }
      output.push(line.translateToString(true));
    }

    return {
      text: output.join("\n"),
      readMode: "xterm-buffer",
      source: "xterm-buffer"
    };
  }

  try {
    const pageResult = await requestPageHook("read-xterm-buffer", { lines });
    if (pageResult && pageResult.found) {
      return {
        text: pageResult.text,
        readMode: "xterm-buffer",
        source: "page-xterm-buffer"
      };
    }
    if (pageResult && pageResult.socketText) {
      return {
        text: pageResult.socketText,
        readMode: "websocket-stream",
        source: "page-websocket"
      };
    }
  } catch (_) {
    return null;
  }

  return null;
}

async function getPageHookStats() {
  if (detectAdapter() !== "xterm-dom") {
    return null;
  }

  try {
    return await requestPageHook("hook-stats");
  } catch (error) {
    return {
      error: String(error && error.message ? error.message : error)
    };
  }
}

function determineReadMode(adapter, pageHook) {
  if (adapter === "novnc") {
    return "unavailable";
  }

  if (findXtermObject() || pageHook?.terminalCount) {
    return "xterm-buffer";
  }

  if (pageHook?.socketChunkCount) {
    return "websocket-stream";
  }

  const root = findReadableTerminalRoot();
  if (root && root.innerText) {
    return "dom-text";
  }

  return "unknown";
}

async function readTerminal(lines) {
  const adapter = detectAdapter();
  if (adapter === "novnc") {
    const canvas = findNoVncCanvas();
    return {
      text: "[webssh-remote-linux] noVNC canvas detected; DOM text read is not available for this console.",
      lines: 1,
      source: canvas ? "canvas" : "novnc",
      adapter: "novnc",
      readMode: "unavailable",
      readable: false,
      url: location.href,
      title: document.title
    };
  }

  const xtermRead = await readXterm(lines);
  if (xtermRead != null) {
    const allLines = xtermRead.text.split("\n");
    return {
      text: xtermRead.text,
      lines: allLines.length,
      source: xtermRead.source,
      adapter,
      readMode: xtermRead.readMode,
      readable: true,
      url: location.href,
      title: document.title
    };
  }

  const domRead = readDomText(lines);
  return {
    text: domRead.text,
    lines: domRead.lines,
    source: domRead.source,
    adapter,
    readMode: domRead.readMode,
    readable: true,
    url: location.href,
    title: document.title
  };
}

async function probeTerminal() {
  const inputSelectors = [
    "#noVNC_keyboardinput",
    "#noVNC_clipboard_text",
    ".xterm-helper-textarea",
    ".xterm textarea",
    "textarea[aria-label*='Terminal' i]",
    "textarea",
    "[contenteditable='true']",
    "[role='textbox']"
  ];
  const readableSelectors = [
    "#noVNC_canvas",
    ".xterm-screen",
    ".xterm-rows",
    ".terminal",
    "[class*='terminal' i]",
    "pre",
    "canvas"
  ];

  const adapter = detectAdapter();
  const pageHook = await getPageHookStats();
  const readMode = determineReadMode(adapter, pageHook);

  return {
    url: location.href,
    title: document.title,
    adapter,
    readMode,
    readable: readMode !== "unavailable" && readMode !== "unknown",
    capabilities: {
      domText: Boolean(findReadableTerminalRoot()?.innerText),
      xtermBuffer: Boolean(findXtermObject()) || Boolean(pageHook?.terminalCount),
      websocketStream: Boolean(pageHook?.socketChunkCount),
      pageHook: Boolean(pageHook && !pageHook.error),
      noVncCanvas: adapter === "novnc" && Boolean(findNoVncCanvas())
    },
    activeElement: describeElement(document.activeElement),
    terminalInput: describeElement(findTerminalElement()),
    readableRoot: describeElement(findReadableTerminalRoot()),
    xterm: {
      hasXterm: Boolean(document.querySelector(".xterm")),
      hasRows: Boolean(document.querySelector(".xterm-rows")),
      hasHelperTextarea: Boolean(document.querySelector(".xterm-helper-textarea")),
      hasScreen: Boolean(document.querySelector(".xterm-screen")),
      hasInspectableBuffer: Boolean(findXtermObject()) || Boolean(pageHook?.terminalCount),
      hasWebSocketHook: Boolean(pageHook?.webSocketPatched),
      hasSocketCapture: Boolean(pageHook?.socketChunkCount),
      pageHook
    },
    inputCandidates: queryCandidates(inputSelectors, 8),
    readableCandidates: queryCandidates(readableSelectors, 8)
  };
}

function dispatchTextInput(target, text) {
  target.focus();

  const inputEvent = new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    inputType: "insertText",
    data: text
  });
  target.dispatchEvent(inputEvent);

  if ("value" in target) {
    setNativeValue(target, target.value + text);
  } else {
    target.textContent += text;
  }

  target.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: text
    })
  );
}

function setNativeValue(element, value) {
  const prototype = Object.getPrototypeOf(element);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  if (descriptor && typeof descriptor.set === "function") {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }
}

function dispatchPaste(target, text) {
  try {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: data
    });
    return { dispatched: true, canceled: !target.dispatchEvent(event) };
  } catch (_) {
    return { dispatched: false, canceled: false };
  }
}

function keySpecFromName(name) {
  const normalized = String(name || "").toLowerCase();

  if (normalized === "enter") {
    return { key: "Enter", code: "Enter", keyCode: 13, which: 13, charCode: 13 };
  }

  if (normalized === "ctrl-c" || normalized === "ctrl+c") {
    return { key: "c", code: "KeyC", keyCode: 67, which: 67, charCode: 3, ctrlKey: true };
  }

  throw new Error(`unsupported key: ${name}`);
}

function dispatchKeyboard(target, keySpec) {
  target.focus();

  const options = {
    key: keySpec.key,
    code: keySpec.code || keySpec.key,
    keyCode: keySpec.keyCode || 0,
    which: keySpec.which || keySpec.keyCode || 0,
    charCode: keySpec.charCode || 0,
    bubbles: true,
    cancelable: true,
    ctrlKey: Boolean(keySpec.ctrlKey),
    metaKey: Boolean(keySpec.metaKey),
    altKey: Boolean(keySpec.altKey),
    shiftKey: Boolean(keySpec.shiftKey)
  };

  for (const type of ["keydown", "keypress", "keyup"]) {
    target.dispatchEvent(new KeyboardEvent(type, options));
  }
}

function dispatchTextAsKeyboard(target, text) {
  for (const char of text) {
    if (char === "\n") {
      dispatchKeyboard(target, keySpecFromName("enter"));
      continue;
    }

    dispatchKeyboard(target, {
      key: char,
      code: char.length === 1 && /[a-z]/i.test(char) ? `Key${char.toUpperCase()}` : char,
      keyCode: char.length === 1 ? char.toUpperCase().charCodeAt(0) : 0,
      which: char.length === 1 ? char.toUpperCase().charCodeAt(0) : 0,
      charCode: char.length === 1 ? char.charCodeAt(0) : 0,
      shiftKey: char.length === 1 && char.toUpperCase() === char && char.toLowerCase() !== char
    });
  }
}

function dispatchTerminalKey(keySpec) {
  const input = findTerminalElement();
  const container = findTerminalContainer();
  const targets = [];

  if (input) {
    targets.push(input);
  }

  if (container && container !== input) {
    targets.push(container);
  }

  if (targets.length === 0) {
    targets.push(document.activeElement || document.body);
  }

  for (const target of targets) {
    dispatchKeyboard(target, keySpec);
  }
}

function sendTerminal(text, enter) {
  if (detectAdapter() === "novnc") {
    return sendNoVncTerminal(text, enter);
  }

  const target = findTerminalElement();
  if (!target) {
    throw new Error("no terminal input element found");
  }

  const paste = dispatchPaste(target, text);
  if (!paste.canceled) {
    dispatchTextInput(target, text);
  }
  if (enter) {
    dispatchTerminalKey(keySpecFromName("enter"));
  }

  return {
    sent: true,
    enter: Boolean(enter),
    target: target.tagName.toLowerCase(),
    url: location.href,
    title: document.title
  };
}

function sendNoVncTerminal(text, enter) {
  const target = findNoVncKeyboardInput() || findNoVncCanvas();
  if (!target) {
    throw new Error("no noVNC keyboard input or canvas found");
  }

  target.focus?.();
  dispatchTextInput(target, text);
  dispatchTextAsKeyboard(target, text);
  if (enter) {
    dispatchKeyboard(target, keySpecFromName("enter"));
  }

  return {
    sent: true,
    enter: Boolean(enter),
    adapter: "novnc",
    readable: false,
    target: target.tagName.toLowerCase(),
    id: target.id || "",
    url: location.href,
    title: document.title
  };
}

function sendKey(name) {
  const target = findTerminalContainer();
  if (!target) {
    throw new Error("no terminal target found");
  }

  dispatchTerminalKey(keySpecFromName(name));

  return {
    sent: true,
    key: name,
    adapter: detectAdapter(),
    target: target.tagName.toLowerCase(),
    url: location.href,
    title: document.title
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (!message || typeof message !== "object") {
      return false;
    }

    if (message.type === "webssh.probe") {
      probeTerminal()
        .then((result) => sendResponse({ ok: true, result }))
        .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
      return true;
    }

    if (message.type === "webssh.read") {
      readTerminal(message.lines)
        .then((result) => sendResponse({ ok: true, result }))
        .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
      return true;
    }

    if (message.type === "webssh.send") {
      sendResponse({
        ok: true,
        result: sendTerminal(message.text || "", message.enter !== false)
      });
      return false;
    }

    if (message.type === "webssh.key") {
      sendResponse({
        ok: true,
        result: sendKey(message.key)
      });
      return false;
    }

    return false;
  } catch (error) {
    sendResponse({ ok: false, error: String(error.message || error) });
    return false;
  }
});
