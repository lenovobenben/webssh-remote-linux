#!/usr/bin/env node
"use strict";

const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HOST = process.env.WEBSSH_BRIDGE_HOST || "127.0.0.1";
const PORT = Number.parseInt(process.env.WEBSSH_BRIDGE_PORT || "8765", 10);
const MAX_BODY_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.WEBSSH_BRIDGE_TIMEOUT_MS || "30000", 10);
const TOKEN_FILE =
  process.env.WEBSSH_BRIDGE_TOKEN_FILE ||
  path.join(os.homedir(), ".codex", "webssh-remote-linux", "bridge-token.json");
const BRIDGE_TOKEN = process.env.WEBSSH_BRIDGE_TOKEN || crypto.randomBytes(32).toString("hex");

let nativeInputBuffer = Buffer.alloc(0);
const pendingHttp = new Map();

function nowRequestId() {
  return `${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
}

function sendNativeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

function parseNativeInput() {
  while (nativeInputBuffer.length >= 4) {
    const length = nativeInputBuffer.readUInt32LE(0);
    if (nativeInputBuffer.length < length + 4) {
      return;
    }

    const body = nativeInputBuffer.subarray(4, 4 + length);
    nativeInputBuffer = nativeInputBuffer.subarray(4 + length);

    let message;
    try {
      message = JSON.parse(body.toString("utf8"));
    } catch (error) {
      console.error(`[webssh-native-host] invalid JSON from extension: ${error.message}`);
      continue;
    }

    handleNativeMessage(message);
  }
}

function handleNativeMessage(message) {
  if (!message || typeof message !== "object") {
    return;
  }

  if (message.type === "bridge.ping") {
    sendNativeMessage({
      id: message.id,
      type: "bridge.pong",
      ok: true,
      result: {
        pid: process.pid,
        host: HOST,
        port: PORT,
        token_file: TOKEN_FILE
      }
    });
    return;
  }

  if (message.type !== "bridge.response") {
    return;
  }

  const pending = pendingHttp.get(message.id);
  if (!pending) {
    return;
  }

  clearTimeout(pending.timer);
  pendingHttp.delete(message.id);
  writeJson(pending.response, message.ok ? 200 : 502, message);
}

function forwardToExtension(request, response) {
  const id = request.request_id || nowRequestId();
  const message = {
    id,
    type: "bridge.request",
    request
  };

  const timer = setTimeout(() => {
    pendingHttp.delete(id);
    writeJson(response, 504, {
      id,
      ok: false,
      error: "timed out waiting for Chrome extension response"
    });
  }, REQUEST_TIMEOUT_MS);

  pendingHttp.set(id, { response, timer });
  sendNativeMessage(message);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error(`invalid JSON body: ${error.message}`));
      }
    });

    request.on("error", reject);
  });
}

function writeJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

function writeTokenFile() {
  const dir = path.dirname(TOKEN_FILE);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const payload = {
    schema_version: 1,
    service: "webssh-remote-linux-native-host",
    host: HOST,
    port: PORT,
    token: BRIDGE_TOKEN,
    pid: process.pid,
    created_at: new Date().toISOString()
  };
  const tmp = `${TOKEN_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, TOKEN_FILE);
  fs.chmodSync(TOKEN_FILE, 0o600);
}

function isAuthorized(request) {
  const provided = request.headers["x-webssh-bridge-token"];
  if (typeof provided !== "string" || provided.length !== BRIDGE_TOKEN.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(BRIDGE_TOKEN));
}

function route(request, response) {
  if (request.socket.remoteAddress !== "127.0.0.1" && request.socket.remoteAddress !== "::ffff:127.0.0.1") {
    writeJson(response, 403, { ok: false, error: "loopback clients only" });
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    writeJson(response, 200, {
      ok: true,
      service: "webssh-remote-linux-native-host",
      pid: process.pid,
      token_file: TOKEN_FILE
    });
    return;
  }

  if (request.method !== "POST" || request.url !== "/request") {
    writeJson(response, 404, { ok: false, error: "not found" });
    return;
  }

  if (!isAuthorized(request)) {
    writeJson(response, 401, { ok: false, error: "invalid or missing bridge token" });
    return;
  }

  readJsonBody(request)
    .then((payload) => {
      if (!payload || typeof payload !== "object" || typeof payload.action !== "string") {
        writeJson(response, 400, { ok: false, error: "payload.action is required" });
        return;
      }
      forwardToExtension(payload, response);
    })
    .catch((error) => {
      writeJson(response, 400, { ok: false, error: String(error.message || error) });
    });
}

process.stdin.on("data", (chunk) => {
  nativeInputBuffer = Buffer.concat([nativeInputBuffer, chunk]);
  parseNativeInput();
});

process.stdin.on("end", () => {
  process.exit(0);
});

const server = http.createServer(route);
server.listen(PORT, HOST, () => {
  writeTokenFile();
  console.error(`[webssh-native-host] listening on http://${HOST}:${PORT}`);
  console.error(`[webssh-native-host] token file: ${TOKEN_FILE}`);
});
