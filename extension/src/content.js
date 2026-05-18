function findTerminalElement() {
  const selectors = [
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

function readTerminal(lines) {
  const root = findReadableTerminalRoot();
  const text = (root && root.innerText ? root.innerText : "").replace(/\r/g, "");
  const allLines = text.split("\n");
  const requested = Number.isInteger(lines) && lines > 0 ? lines : 40;
  return {
    text: allLines.slice(-requested).join("\n"),
    lines: Math.min(requested, allLines.length),
    source: root ? root.tagName.toLowerCase() : null,
    url: location.href,
    title: document.title
  };
}

function probeTerminal() {
  const inputSelectors = [
    ".xterm-helper-textarea",
    ".xterm textarea",
    "textarea[aria-label*='Terminal' i]",
    "textarea",
    "[contenteditable='true']",
    "[role='textbox']"
  ];
  const readableSelectors = [
    ".xterm-screen",
    ".xterm-rows",
    ".terminal",
    "[class*='terminal' i]",
    "pre",
    "canvas"
  ];

  return {
    url: location.href,
    title: document.title,
    activeElement: describeElement(document.activeElement),
    terminalInput: describeElement(findTerminalElement()),
    readableRoot: describeElement(findReadableTerminalRoot()),
    xterm: {
      hasXterm: Boolean(document.querySelector(".xterm")),
      hasRows: Boolean(document.querySelector(".xterm-rows")),
      hasHelperTextarea: Boolean(document.querySelector(".xterm-helper-textarea")),
      hasScreen: Boolean(document.querySelector(".xterm-screen"))
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
    target.value += text;
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
    return { key: "Enter", code: "Enter" };
  }

  if (normalized === "ctrl-c" || normalized === "ctrl+c") {
    return { key: "c", code: "KeyC", ctrlKey: true };
  }

  throw new Error(`unsupported key: ${name}`);
}

function dispatchKeyboard(target, keySpec) {
  target.focus();

  const options = {
    key: keySpec.key,
    code: keySpec.code || keySpec.key,
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

function sendKey(name) {
  const target = findTerminalContainer();
  if (!target) {
    throw new Error("no terminal target found");
  }

  dispatchTerminalKey(keySpecFromName(name));

  return {
    sent: true,
    key: name,
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
      sendResponse({
        ok: true,
        result: probeTerminal()
      });
      return false;
    }

    if (message.type === "webssh.read") {
      sendResponse({ ok: true, result: readTerminal(message.lines) });
      return false;
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
