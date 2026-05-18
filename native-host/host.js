#!/usr/bin/env node
"use strict";

const http = require("node:http");
const crypto = require("node:crypto");

const HOST = process.env.WEBSSH_BRIDGE_HOST || "127.0.0.1";
const PORT = Number.parseInt(process.env.WEBSSH_BRIDGE_PORT || "8765", 10);
const MAX_BODY_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.WEBSSH_BRIDGE_TIMEOUT_MS || "30000", 10);

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

function route(request, response) {
  if (request.socket.remoteAddress !== "127.0.0.1" && request.socket.remoteAddress !== "::ffff:127.0.0.1") {
    writeJson(response, 403, { ok: false, error: "loopback clients only" });
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    writeJson(response, 200, { ok: true, service: "webssh-remote-linux-native-host" });
    return;
  }

  if (request.method !== "POST" || request.url !== "/request") {
    writeJson(response, 404, { ok: false, error: "not found" });
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
  console.error(`[webssh-native-host] listening on http://${HOST}:${PORT}`);
});
