#!/usr/bin/env node
const crypto = require("node:crypto");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const HOST = process.env.MOCK_WEBSOCKET_HOST || "127.0.0.1";
const PORT = Number(process.env.MOCK_WEBSOCKET_PORT || 18081);
const root = __dirname;
const prompt = "mock-ws@webssh:~$ ";

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);
  const pathname = url.pathname === "/" ? "/mock-websocket-terminal.html" : url.pathname;
  const filePath = path.join(root, pathname);

  if (!filePath.startsWith(root) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404);
    response.end("not found");
    return;
  }

  response.writeHead(200, {
    "content-type": contentType(filePath)
  });
  fs.createReadStream(filePath).pipe(response);
});

server.on("upgrade", (request, socket) => {
  if (request.url !== "/terminal") {
    socket.destroy();
    return;
  }

  const key = request.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "",
    ""
  ].join("\r\n"));

  writeText(socket, `${prompt}`);

  socket.on("data", (chunk) => {
    const command = readClientTextFrame(chunk).trimEnd();
    if (!command) {
      writeText(socket, `\r\n${prompt}`);
      return;
    }

    writeText(socket, `\r\n${prompt}${command}\r\n`);
    for (const line of runMockCommand(command)) {
      writeText(socket, `${line}\r\n`);
    }
    writeText(socket, prompt);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Mock WebSocket terminal: http://${HOST}:${PORT}/`);
});

function contentType(filePath) {
  if (filePath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (filePath.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}

function runMockCommand(command) {
  const wrappedOutput = executeWrappedRun(command);
  if (wrappedOutput) {
    return wrappedOutput;
  }

  if (command === "pwd") {
    return ["/home/mock-ws"];
  }
  if (command === "hostname") {
    return ["mock-websocket"];
  }
  if (command === "date") {
    return [new Date().toString()];
  }
  if (command.startsWith("echo ")) {
    return [command.slice(5)];
  }
  if (command === "clear") {
    return ["[screen cleared]"];
  }
  return [`mock-ws: command not found: ${command}`];
}

function executeWrappedRun(command) {
  const beginMatch = command.match(/printf '\\n%s\\n' '([^']+_BEGIN__)'/);
  const encodedMatch = command.match(/printf '%s' '([^']+)' \| base64 -d \| bash/);
  const endMatch = command.match(/printf '\\n%s:%s\\n' '([^']+_END__)'/);

  if (!beginMatch || !encodedMatch || !endMatch) {
    return null;
  }

  const begin = beginMatch[1];
  const decoded = Buffer.from(encodedMatch[1], "base64").toString("utf8");
  const end = endMatch[1];
  return ["", begin, ...runSimpleParts(decoded), `${end}:0`];
}

function runSimpleParts(command) {
  const output = [];
  const parts = command.split(";").map((part) => part.trim()).filter(Boolean);
  for (const part of parts) {
    output.push(...runMockCommand(part));
  }
  return output;
}

function writeText(socket, text) {
  // ttyd output frames are prefixed with 0. The page hook strips this prefix.
  const payload = Buffer.from(`0${text}`, "utf8");
  const header = [];
  header.push(0x81);
  if (payload.length < 126) {
    header.push(payload.length);
  } else if (payload.length < 65536) {
    header.push(126, (payload.length >> 8) & 0xff, payload.length & 0xff);
  } else {
    throw new Error("mock frame too large");
  }
  socket.write(Buffer.concat([Buffer.from(header), payload]));
}

function readClientTextFrame(buffer) {
  if (buffer.length < 6) {
    return "";
  }

  let offset = 2;
  let length = buffer[1] & 0x7f;
  if (length === 126) {
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    return "";
  }

  const masked = Boolean(buffer[1] & 0x80);
  if (!masked || buffer.length < offset + 4 + length) {
    return "";
  }

  const mask = buffer.subarray(offset, offset + 4);
  offset += 4;
  const payload = Buffer.alloc(length);
  for (let index = 0; index < length; index++) {
    payload[index] = buffer[offset + index] ^ mask[index % 4];
  }
  return payload.toString("utf8");
}
