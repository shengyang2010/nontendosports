// Bowling Party server. Zero dependencies: run `node server.js`.
// Serves the pages in ./public and relays WebSocket messages between the laptop (host) and phones.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL || ""; // e.g. your https tunnel URL
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

// ---------- HTTP ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/info") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ port: PORT, publicUrl: PUBLIC_URL, lan: lanAddresses() }));
  }
  let p = url.pathname === "/" ? "/host.html" : url.pathname;
  if (p === "/play") p = "/controller.html";
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(data);
  });
});

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal && !i.address.startsWith("169.254."))
    .map((i) => i.address)
    // prefer typical home Wi-Fi addresses over VPN / virtual adapters
    .sort((a, b) => rank(a) - rank(b));
}
function rank(ip) {
  return ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3;
}

// ---------- Minimal WebSocket (RFC 6455, text frames only) ----------
class Socket {
  constructor(sock) {
    this.sock = sock; this.buf = Buffer.alloc(0); this.open = true; this.isAlive = true;
    this.onmessage = () => {}; this.onclose = () => {};
    sock.setNoDelay(true);
    sock.on("data", (d) => { this.buf = Buffer.concat([this.buf, d]); this.parse(); });
    sock.on("close", () => this.closed());
    sock.on("error", () => this.closed());
  }
  get readyState() { return this.open ? 1 : 3; }
  parse() {
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      let len = b1 & 127, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (len > 64 * 1024) return this.close(1009);
      const masked = b1 & 128;
      const total = off + (masked ? 4 : 0) + len;
      if (this.buf.length < total) return;
      let payload = this.buf.subarray(off + (masked ? 4 : 0), total);
      if (masked) {
        const mask = this.buf.subarray(off, off + 4);
        payload = Buffer.from(payload.map((v, i) => v ^ mask[i & 3]));
      }
      this.buf = this.buf.subarray(total);
      const op = b0 & 15;
      if (op === 1) this.onmessage(payload.toString("utf8"));
      else if (op === 8) return this.close(1000);
      else if (op === 9) this.frame(10, payload);       // ping -> pong
      else if (op === 10) this.isAlive = true;          // pong
    }
  }
  frame(op, data) {
    if (!this.open) return;
    const len = data.length;
    const head = len < 126 ? Buffer.from([128 | op, len])
      : len < 65536 ? Buffer.from([128 | op, 126, len >> 8, len & 255])
      : (() => { const h = Buffer.alloc(10); h[0] = 128 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); return h; })();
    this.sock.write(Buffer.concat([head, data]));
  }
  send(text) { this.frame(1, Buffer.from(text)); }
  ping() { this.frame(9, Buffer.alloc(0)); }
  close(code = 1000, reason = "") {
    if (!this.open) return;
    const b = Buffer.alloc(2); b.writeUInt16BE(code);
    this.frame(8, Buffer.concat([b, Buffer.from(reason)]));
    this.sock.end();
    this.closed();
  }
  terminate() { this.sock.destroy(); this.closed(); }
  closed() { if (this.open) { this.open = false; this.onclose(); } }
}

const clients = new Set();
server.on("upgrade", (req, sock) => {
  if (new URL(req.url, "http://x").pathname !== "/ws" || !req.headers["sec-websocket-key"]) return sock.destroy();
  const accept = crypto.createHash("sha1")
    .update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const ws = new Socket(sock);
  clients.add(ws);
  ws.onmessage = (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg && typeof msg.type === "string") handle(ws, msg);
  };
  ws.onclose = () => { clients.delete(ws); onClose(ws); };
});

// ---------- Rooms ----------
const rooms = new Map(); // code -> { host, hostToken, players: {1:{ws,token}, 2:{...}}, lastActive }
const send = (ws, msg) => ws?.readyState === 1 && ws.send(JSON.stringify(msg));
const newCode = () => {
  let c;
  do c = Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[crypto.randomInt(24)]).join(""); while (rooms.has(c));
  return c;
};

function onClose(ws) {
  const r = rooms.get(ws.room);
  if (!r) return;
  if (ws.role === "host" && r.host === ws) r.host = null;
  if (ws.role === "player" && r.players[ws.player]?.ws === ws) {
    r.players[ws.player].ws = null;
    send(r.host, { type: "player_status", player: ws.player, connected: false });
  }
}

function handle(ws, msg) {
  const r0 = rooms.get(ws.room);
  if (r0) r0.lastActive = Date.now();

  switch (msg.type) {
    case "host_create": {
      const room = newCode();
      const r = { host: ws, hostToken: crypto.randomUUID(), players: {}, lastActive: Date.now() };
      rooms.set(room, r);
      Object.assign(ws, { room, role: "host" });
      return send(ws, { type: "room_created", room, hostToken: r.hostToken });
    }

    case "host_resume": {
      const r = rooms.get(msg.room);
      if (!r || r.hostToken !== msg.hostToken) return send(ws, { type: "error", code: "bad_room" });
      if (r.host && r.host !== ws) r.host.close(4000, "replaced");
      r.host = ws;
      Object.assign(ws, { room: msg.room, role: "host" });
      send(ws, { type: "resumed", room: msg.room });
      for (const [p, s] of Object.entries(r.players))
        send(ws, { type: "player_status", player: +p, connected: !!s.ws });
      return;
    }

    case "join": {
      const room = String(msg.room || "").toUpperCase();
      const r = rooms.get(room);
      if (!r) return send(ws, { type: "error", code: "bad_room" });

      let player = Number(Object.keys(r.players).find((p) => msg.token && r.players[p].token === msg.token)) || 0;
      if (!player) {
        player = [1, 2].find((p) => !r.players[p]);
        if (!player) return send(ws, { type: "error", code: "room_full" });
        r.players[player] = { token: crypto.randomUUID(), ws: null };
      }
      const slot = r.players[player];
      if (slot.ws && slot.ws !== ws) slot.ws.close(4000, "replaced");
      slot.ws = ws;
      Object.assign(ws, { room, role: "player", player });
      send(ws, { type: "joined", player, token: slot.token, room });
      return send(r.host, { type: "player_status", player, connected: true });
    }

    case "ping":
      return send(ws, { type: "pong", t: msg.t });

    default: {
      const r = rooms.get(ws.room);
      if (!r) return;
      if (ws.role === "player") {
        send(r.host, { ...msg, player: ws.player }); // server stamps identity
      } else if (ws.role === "host") {
        if (msg.to) send(r.players[msg.to]?.ws, msg);
        else for (const s of Object.values(r.players)) send(s.ws, msg);
      }
    }
  }
}

// Drop dead sockets every 10 s; expire rooms idle for 3 h
setInterval(() => {
  for (const ws of clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
  for (const [c, r] of rooms) if (Date.now() - r.lastActive > 3 * 3600e3) rooms.delete(c);
}, 10_000).unref();

server.listen(PORT, () => {
  console.log(`\n  Bowling Party running`);
  console.log(`  Laptop: open http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  Same Wi-Fi: http://${ip}:${PORT}`);
  if (PUBLIC_URL) console.log(`  Public URL: ${PUBLIC_URL}`);
  console.log("");
});

export { server };
