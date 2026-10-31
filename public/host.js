// Laptop core: networking, lobby + sport picker, shared UI, main loop. Sports live in ./games/.
import { BowlingGame } from "./games/bowling.js";
import { GolfGame } from "./games/golf.js";

const SPORTS = { bowling: BowlingGame, golf: GolfGame };
const COLORS = { 1: "#ff6b6b", 2: "#2ec4b6" };
const $ = (id) => document.getElementById(id);
const canvas = $("lane");

const connected = { 1: false, 2: false };
const lastAck = { 1: null, 2: null };
let paused = false;
let phase = "lobby", sport = localStorage.getItem("party:sport") || "bowling", game = null, order = [];

// ---------- Shared UI used by the games ----------
const ui = {
  pop(text) {
    const el = $("pop");
    el.textContent = text;
    el.className = "";
    void el.offsetWidth;
    el.className = "go" + (text.length > 8 ? " small" : "");
  },
  confetti() {
    const cols = ["#ff6b6b", "#ffcc33", "#2ec4b6", "#5b7cfa", "#ffffff"];
    for (let i = 0; i < 90; i++) {
      const d = document.createElement("div");
      d.className = "confetti";
      d.style.left = Math.random() * 100 + "vw";
      d.style.background = cols[i % cols.length];
      d.style.animationDuration = 1.8 + Math.random() * 1.6 + "s";
      d.style.animationDelay = Math.random() * 0.4 + "s";
      document.body.append(d);
      setTimeout(() => d.remove(), 4000);
    }
  },
  banner(text, player, ready) {
    const t = $("turn");
    if (!text) return t.classList.remove("ready", "show");
    t.textContent = text;
    t.style.background = COLORS[player];
    t.classList.add("show");
    t.classList.toggle("ready", !!ready);
  },
  board(html) { $("board").innerHTML = html; },
  info(html) { $("info").innerHTML = html; $("info").classList.toggle("show", !!html); },
  gameOver({ totals, winners, unit, low }) {
    phase = "over";
    $("turn").classList.remove("show");
    const best = totals.find((t) => winners.includes(t.p));
    $("winner").textContent = totals.length === 1 ? `You scored ${best.value}${unit ? " " + unit : ""}!` :
      winners.length > 1 ? "It's a tie!" : `Player ${winners[0]} wins!`;
    $("final").innerHTML = totals.map((t) =>
      `<div style="background:${COLORS[t.p]}">Player ${t.p}<b>${t.value}</b>${t.sub ? `<small>${t.sub}</small>` : ""}</div>`).join("");
    $("over").classList.remove("hidden");
    send({ type: "game_over", winners, totals });
    ui.confetti();
  },
};

// ---------- Networking ----------
let ws, backoff = 500;
const send = (m) => ws?.readyState === 1 && ws.send(JSON.stringify(m));

function connect() {
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.onopen = () => {
    backoff = 500;
    const saved = JSON.parse(sessionStorage.getItem("bowl:host") || "null");
    send(saved ? { type: "host_resume", ...saved } : { type: "host_create" });
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    switch (m.type) {
      case "room_created":
        sessionStorage.setItem("bowl:host", JSON.stringify({ room: m.room, hostToken: m.hostToken }));
        setRoom(m.room);
        break;
      case "resumed": setRoom(m.room); break;
      case "error":
        if (m.code === "bad_room") { sessionStorage.removeItem("bowl:host"); send({ type: "host_create" }); }
        break;
      case "player_status": onPlayerStatus(m); break;
      case "throw": onThrow(m); break;
      case "menu": onMenu(m.action, m.player); break;
      default: if (phase === "playing" && !paused) game?.onMsg(m);
    }
  };
  ws.onclose = (e) => {
    if (e.code === 4000) return;
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 5000);
  };
}

function onThrow(m) {
  const prev = lastAck[m.player];
  if (prev && m.seq <= prev.seq) {
    return send({ type: "throw_ack", seq: m.seq, accepted: m.seq === prev.seq && prev.accepted, reason: "duplicate", to: m.player });
  }
  const res = paused ? { accepted: false, reason: "paused" } : phase === "playing" && game ? game.handleThrow(m) : { accepted: false, reason: "not_started" };
  const ack = { type: "throw_ack", seq: m.seq, ...res };
  lastAck[m.player] = ack;
  send({ ...ack, to: m.player });
}

function onPlayerStatus({ player, connected: on }) {
  connected[player] = on;
  const card = $(`card${player}`);
  card.classList.toggle("on", on);
  card.querySelector(".state").textContent = on ? "Ready!" : "Waiting…";
  $(`st${player}`).classList.toggle("on", on);
  $("start").disabled = !(connected[1] || connected[2]);
  if (on) {
    send({ type: "phase", phase, sport, to: player });
    if (phase === "playing" && game && !game.over) send({ ...game.turnMsg(), to: player });
  }
}

// ---------- Lobby ----------
async function setRoom(code) {
  $("code").textContent = code;
  $("roomtag").textContent = `Room ${code}`;
  const url = await buildJoinUrl(code);
  $("url").textContent = url;
  showQr(url);
}

async function buildJoinUrl(code) {
  let base = location.origin;
  try {
    const info = await (await fetch("/info")).json();
    if (info.publicUrl) base = info.publicUrl.replace(/\/$/, "");
    else if (["localhost", "127.0.0.1"].includes(location.hostname) && info.lan[0]) base = `http://${info.lan[0]}:${info.port}`;
  } catch {}
  if (!base.startsWith("https:")) {
    $("httpsNote").textContent = "Tip: phones only share motion sensors over HTTPS. Over plain http, phones use touch controls instead. " +
      "For swing controls, open this page through a tunnel (see README).";
  }
  return `${base}/play?room=${code}`;
}

function showQr(text) {
  const box = $("qr");
  const draw = () => {
    const q = window.qrcode(0, "M"); q.addData(text); q.make();
    box.innerHTML = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  };
  if (window.qrcode) return draw();
  const s = document.createElement("script");
  s.src = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js";
  s.onload = draw;
  s.onerror = () => {
    const img = new Image();
    img.onerror = () => (box.textContent = "Open the link below on your phone");
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(text)}`;
    box.replaceChildren(img);
  };
  document.head.append(s);
}

function pickSport(s) {
  sport = s;
  localStorage.setItem("party:sport", s);
  document.querySelectorAll(".sport").forEach((el) => el.classList.toggle("picked", el.dataset.sport === s));
  send({ type: "phase", phase, sport });
}
document.querySelectorAll(".sport").forEach((el) => (el.onclick = () => pickSport(el.dataset.sport)));
pickSport(sport);

// ---------- Game flow ----------
function startGame(players) {
  order = players;
  phase = "playing";
  game = new SPORTS[sport]({ canvas, send, ui, colors: COLORS, connected });
  document.body.dataset.sport = sport;
  $("lobby").classList.add("hidden");
  $("over").classList.add("hidden");
  $("hud").classList.add("show");
  $("roomtag").style.display = "block";
  $("menuBtn").style.display = "block";
  setPaused(false);
  ui.info("");
  send({ type: "phase", phase: "playing", sport });
  game.start(order);
}

function toLobby() {
  setPaused(false);
  phase = "lobby";
  game = null;
  send({ type: "phase", phase: "lobby", sport });
  $("over").classList.add("hidden");
  $("hud").classList.remove("show");
  $("turn").classList.remove("show");
  ui.info("");
  $("lobby").classList.remove("hidden");
  $("menuBtn").style.display = "none";
}

$("start").onclick = () => startGame([1, 2].filter((p) => connected[p]));
$("practice").onclick = () => startGame([1]);
$("again").onclick = () => startGame(order);
$("toLobby").onclick = toLobby;
addEventListener("keydown", (e) => {
  if (e.code === "Escape" && phase === "playing") return setPaused(!paused);
  if (phase === "playing" && game && !game.over && !paused) game.key(e);
});

// ---------- Pause / exit menu (laptop button, Esc, or any phone) ----------
function setPaused(on, by) {
  paused = on && phase === "playing";
  $("pause").classList.toggle("hidden", !paused);
  $("pauseBy").textContent = by ? `Paused by Player ${by}` : "";
  send({ type: "paused", paused });
}
function onMenu(action, by) {
  if (phase !== "playing" && action !== "quit") return;
  if (action === "pause") setPaused(true, by);
  if (action === "resume") setPaused(false);
  if (action === "restart") { setPaused(false); startGame(order); }
  if (action === "quit") toLobby();
}
$("menuBtn").onclick = () => setPaused(true);
$("resume").onclick = () => onMenu("resume");
$("restart").onclick = () => onMenu("restart");
$("quit").onclick = () => onMenu("quit");

// ---------- Canvas + loop ----------
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = canvas.clientWidth * dpr; canvas.height = canvas.clientHeight * dpr;
  canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener("resize", resize);
resize();

let last = performance.now();
const idle = new BowlingGame({ canvas, send() {}, ui: { ...ui, banner() {}, board() {}, pop() {} }, colors: COLORS, connected });
idle.order = [1]; idle.idx = 0; idle.rolls = { 1: [] }; idle.over = true;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  (game || idle).frame(paused ? 0 : dt, now); // paused: keep drawing, stop the clock
}
requestAnimationFrame(frame);

window.party = { get game() { return game; }, startGame, pickSport, get phase() { return phase; } };
connect();
