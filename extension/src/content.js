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

function dispatchEnter(target) {
  target.focus();

  for (const type of ["keydown", "keypress", "keyup"]) {
    target.dispatchEvent(
      new KeyboardEvent(type, {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true
      })
    );
  }
}

function sendTerminal(text, enter) {
  const target = findTerminalElement();
  if (!target) {
    throw new Error("no terminal input element found");
  }

  dispatchTextInput(target, text);
  if (enter) {
    dispatchEnter(target);
  }

  return {
    sent: true,
    enter: Boolean(enter),
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
        result: {
          hasInput: Boolean(findTerminalElement()),
          readableSource: findReadableTerminalRoot()?.tagName.toLowerCase() || null,
          url: location.href,
          title: document.title
        }
      });
      return true;
    }

    if (message.type === "webssh.read") {
      sendResponse({ ok: true, result: readTerminal(message.lines) });
      return true;
    }

    if (message.type === "webssh.send") {
      sendResponse({
        ok: true,
        result: sendTerminal(message.text || "", message.enter !== false)
      });
      return true;
    }

    return false;
  } catch (error) {
    sendResponse({ ok: false, error: String(error.message || error) });
    return true;
  }
});
