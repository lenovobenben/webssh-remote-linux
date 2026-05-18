const NATIVE_HOST = "com.webssh_remote_linux.bridge";

let nativePort = null;
let boundTabId = null;

function connectNative() {
  if (nativePort) {
    return nativePort;
  }

  nativePort = chrome.runtime.connectNative(NATIVE_HOST);

  nativePort.onMessage.addListener((message) => {
    handleNativeMessage(message).catch((error) => {
      postNative({
        id: message && message.id,
        ok: false,
        error: String(error && error.message ? error.message : error)
      });
    });
  });

  nativePort.onDisconnect.addListener(() => {
    nativePort = null;
  });

  return nativePort;
}

function postNative(message) {
  const port = connectNative();
  port.postMessage(message);
}

async function sendToBoundTab(payload) {
  if (boundTabId == null) {
    throw new Error("no WebSSH tab is bound");
  }

  return chrome.tabs.sendMessage(boundTabId, payload);
}

async function handleNativeMessage(message) {
  if (!message || typeof message !== "object") {
    throw new Error("invalid native message");
  }

  if (message.type === "bridge.request") {
    const response = await handleBridgeRequest(message);
    postNative({
      id: message.id,
      type: "bridge.response",
      ok: true,
      result: response
    });
    return;
  }

  if (message.type === "bridge.pong") {
    return;
  }

  throw new Error(`unsupported native message type: ${message.type || ""}`);
}

async function handleBridgeRequest(message) {
  const request = message.request || {};
  const action = request.action;

  if (action === "status") {
    return getStatus();
  }

  if (action === "read") {
    return sendToBoundTab({
      type: "webssh.read",
      lines: request.lines
    });
  }

  if (action === "send") {
    return sendToBoundTab({
      type: "webssh.send",
      text: request.text || "",
      enter: request.enter !== false
    });
  }

  if (action === "key") {
    return sendToBoundTab({
      type: "webssh.key",
      key: request.key || ""
    });
  }

  throw new Error(`unsupported bridge action: ${action || ""}`);
}

async function bindActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) {
    throw new Error("no active tab");
  }

  boundTabId = tab.id;
  await chrome.tabs.sendMessage(boundTabId, { type: "webssh.probe" });
  return getStatus(tab);
}

async function getStatus(existingTab) {
  let tab = existingTab || null;
  if (boundTabId != null && !tab) {
    try {
      tab = await chrome.tabs.get(boundTabId);
    } catch (_) {
      boundTabId = null;
    }
  }

  return {
    nativeHost: nativePort ? "connected" : "disconnected",
    boundTabId,
    tab: tab
      ? {
          id: tab.id,
          title: tab.title,
          url: tab.url
        }
      : null
  };
}

chrome.runtime.onInstalled.addListener(() => {
  connectNative();
});

chrome.runtime.onStartup.addListener(() => {
  connectNative();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (message.type === "popup.bindActiveTab") {
    bindActiveTab()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }

  if (message.type === "popup.status") {
    getStatus()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }

  return false;
});

connectNative();
