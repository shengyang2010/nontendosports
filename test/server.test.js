import { test, after } from "node:test";
import assert from "node:assert/strict";
process.env.PORT = "3999";
const { server } = await import("../server.js");
after(() => server.close());

function client() {
  const ws = new WebSocket("ws://localhost:3999/ws");
  const queue = [], waiters = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); const w = waiters.shift(); w ? w(m) : queue.push(m); };
  return {
    ws, open: new Promise((r) => (ws.onopen = r)),
    send: (m) => ws.send(JSON.stringify(m)),
    next: () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((r) => waiters.push(r))),
  };
}

test("create, join, relay with stamped identity, rejoin with token", async () => {
  const host = client(); await host.open;
  host.send({ type: "host_create" });
  const { room } = await host.next();
  assert.match(room, /^[A-Z]{4}$/);

  const p1 = client(); await p1.open;
  p1.send({ type: "join", room: room.toLowerCase() });
  const j = await p1.next();
  assert.equal(j.player, 1);
  assert.deepEqual(await host.next(), { type: "player_status", player: 1, connected: true });

  p1.send({ type: "throw", seq: 1, power: 0.5, spin: 0, aim: 0, player: 2 }); // try to impersonate
  const t = await host.next();
  assert.equal(t.player, 1);

  host.send({ type: "throw_ack", seq: 1, accepted: true, to: 1 });
  assert.equal((await p1.next()).type, "throw_ack");

  // big message (>125 bytes) exercises extended length frames
  host.send({ type: "turn", player: 1, pad: "x".repeat(500) });
  assert.equal((await p1.next()).pad.length, 500);

  p1.ws.close();
  assert.deepEqual(await host.next(), { type: "player_status", player: 1, connected: false });
  const p1b = client(); await p1b.open;
  p1b.send({ type: "join", room, token: j.token });
  assert.equal((await p1b.next()).player, 1);

  const p2 = client(); await p2.open; p2.send({ type: "join", room });
  assert.equal((await p2.next()).player, 2);
  const p3 = client(); await p3.open; p3.send({ type: "join", room });
  assert.equal((await p3.next()).code, "room_full");

  const pong = client(); await pong.open; pong.send({ type: "ping", t: 42 });
  assert.deepEqual(await pong.next(), { type: "pong", t: 42 });
  for (const c of [host, p1b, p2, p3, pong]) c.ws.close();
});
