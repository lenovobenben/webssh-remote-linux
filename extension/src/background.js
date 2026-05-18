const NATIVE_HOST = "com.webssh_remote_linux.bridge";

let nativePort = null;
let boundTabId = null;
let lastNativeError = "";
let nextNativeRequestId = 1;
const pendingNativeMessages = new Map();

function connectNative() {
  if (nativePort) {
    return nativePort;
  }

  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST);
    lastNativeError = "";
  } catch (error) {
    nativePort = null;
    lastNativeError = String(error && error.message ? error.message : error);
    throw error;
  }

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
    const error = chrome.runtime.lastError;
    lastNativeError = error && error.message ? error.message : "native host disconnected";
    nativePort = null;
    for (const pending of pendingNativeMessages.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(lastNativeError));
    }
    pendingNativeMessages.clear();
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

  return sendMessageToTab(boundTabId, payload);
}

async function sendMessageToTab(tabId, payload) {
  await injectPageHelpers(tabId);

  try {
    return await sendTabMessageWithTimeout(tabId, payload);
  } catch (error) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/content.js"]
    });
    return sendTabMessageWithTimeout(tabId, payload);
  }
}

function sendTabMessageWithTimeout(tabId, payload) {
  return Promise.race([
    chrome.tabs.sendMessage(tabId, payload),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("timed out waiting for content script response")), 3000);
    })
  ]);
}

async function injectPageHelpers(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/page-hook.js"],
      world: "MAIN"
    });
  } catch (_) {
    // Some pages disallow MAIN-world injection. Content script has a fallback.
  }
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
    const pending = pendingNativeMessages.get(message.id);
    if (pending) {
      clearTimeout(pending.timer);
      pendingNativeMessages.delete(message.id);
      pending.resolve(message);
    }
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

  if (action === "probe") {
    return sendToBoundTab({
      type: "webssh.probe"
    });
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
  tryConnectNative();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) {
    throw new Error("no active tab");
  }

  boundTabId = tab.id;
  await sendMessageToTab(boundTabId, { type: "webssh.probe" });
  return getStatus(tab);
}

async function getStatus(existingTab) {
  tryConnectNative();

  const nativeHealth = await checkNativeHealth();
  let tab = existingTab || null;
  if (boundTabId != null && !tab) {
    try {
      tab = await chrome.tabs.get(boundTabId);
    } catch (_) {
      boundTabId = null;
    }
  }

  return {
    nativeHost: nativeHealth.ok ? "connected" : "disconnected",
    nativeHostError: nativeHealth.ok ? "" : nativeHealth.error,
    nativeHostResult: nativeHealth.result || null,
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

function tryConnectNative() {
  if (nativePort) {
    return;
  }

  try {
    connectNative();
  } catch (_) {
    // getStatus reports lastNativeError; requests that require native messaging
    // will fail through the native messaging path.
  }
}

async function checkNativeHealth() {
  if (!nativePort) {
    return { ok: false, error: lastNativeError || "native host is not connected" };
  }

  const id = `native-ping-${Date.now()}-${nextNativeRequestId++}`;
  try {
    const response = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingNativeMessages.delete(id);
        reject(new Error("timed out waiting for native host ping"));
      }, 1500);

      pendingNativeMessages.set(id, { resolve, reject, timer });
      nativePort.postMessage({ id, type: "bridge.ping" });
    });

    return {
      ok: Boolean(response && response.ok),
      result: response && response.result ? response.result : null,
      error: response && response.error ? response.error : ""
    };
  } catch (error) {
    lastNativeError = String(error && error.message ? error.message : error);
    return { ok: false, error: lastNativeError };
  }
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
