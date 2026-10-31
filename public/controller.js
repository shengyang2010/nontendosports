// Phone controller for Nontendo Sports (bowling + golf).
// Motion mode when sensors are available over HTTPS, otherwise touch mode.

const CONFIG = {
  // ---- bowling ----
  SPIN_AXIS: "gamma",   // rotation about the phone's long axis
  AIM_AXIS: "alpha",    // (fallback only) swing-based aim
  POWER_MIN: 150,       // deg/s; weaker swings rejected as "too gentle"
  POWER_MAX: 900,       // deg/s; maps to full power
  SPIN_WINDOW_MS: 250,
  SPIN_MAX_DEG: 70,
  AIM_MAX_DEG: 25,
  AIM_TILT_MAX_DEG: 30, // tilt this far left/right = full aim
  AIM_DEADZONE_DEG: 3,
  MIN_HOLD_MS: 250,
  STILL_NOISE_MAX: 15,
  // ---- golf ----
  // Hold the phone like a club grip: top pointing at the ground, screen facing you.
  // The swing then rotates the phone around the axis coming out of the screen (rotationRate.alpha),
  // and turning the club face rotates it around its long axis (rotationRate.gamma).
  GOLF_SWING_AXIS: "alpha",
  GOLF_FACE_AXIS: "gamma",
  GOLF_FULL_DEG: 170,     // backswing angle for 100% power (full swing)
  PUTT_FULL_DEG: 60,      // backswing angle for 100% on the putter
  GOLF_START_DEG: 12,     // movement needed before a backswing counts
  GOLF_IMPACT_DEG: 8,     // the ball is struck when the club returns within this of address
  GOLF_FACE_MAX_DEG: 25,  // face twist at impact for a full hook/slice
  GOLF_FACE_DEADZONE: 4,
  // ---- touch mode ----
  SWIPE_MIN_PX: 70,
  SWIPE_SPEED_MIN: 0.4,
  SWIPE_SPEED_MAX: 3.0,
};
const COLORS = { 1: "#ff6b6b", 2: "#2ec4b6" };
const HINTS = {
  too_short: "Hold a bit longer while you swing",
  too_gentle: "Swing harder!",
  not_your_turn: "Wait for your turn",
  not_started: "Waiting for the game to start",
  paused: "The game is paused",
  invalid: "Something went wrong, try again",
  short_swipe: "Swipe further up the pad",
  no_backswing: "Swing the phone back first, like a club",
  released: "Keep holding until you hit the ball",
  golf_pull: "Drag down to power up, then flick up to hit",
};

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let room = (params.get("room") || "").toUpperCase();
const LOGGING = params.has("log");

let isPaused = false;
let mode = "motion";          // or "touch"
let sport = "bowling";        // set by the laptop
let currentPlayer = 0, myTurn = false, phase = "lobby", lastTurn = null;

// ---------- UI helpers ----------
function show(id) { document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("show", s.id === id)); }
function setPlayer(p) {
  currentPlayer = p;
  $("me").textContent = `Player ${p}`;
  document.documentElement.style.setProperty("--c", COLORS[p]);
  show("play");
}
function setStatus(s, rtt) {
  $("dot").className = "dot " + s;
  $("ms").textContent = s === "reconnecting" ? "…" : rtt != null ? `${Math.round(rtt)} ms` : "--";
}
let hintTimer;
function showHint(code) {
  $("hint").textContent = HINTS[code] || code;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => ($("hint").textContent = ""), 2400);
}
function showError(code) {
  const text = { bad_room: "Room not found. Check the code on the laptop.", room_full: "This game already has 2 players.",
    opened_elsewhere: "Controller opened in another tab." }[code] || code;
  show("setup");
  $("setupErr").textContent = text;
  if (code === "bad_room") askRoom();
}
function updateTurnUI() {
  document.body.classList.toggle("wait", !myTurn);
  let t = phase !== "playing" ? `Waiting for the host to start… (${sport === "golf" ? "⛳ Golf" : "🎳 Bowling"})` : myTurn ? "Your turn!" : "Other player's turn";
  if (myTurn && lastTurn) t = sport === "golf" ? `Your shot! Stroke ${lastTurn.stroke}` : `Your turn! Frame ${lastTurn.frame}`;
  $("turnText").textContent = t;
  $("golfCtl").classList.toggle("off", !myTurn);
}
function showResult(m) {
  $("result").textContent = m.label;
  clearTimeout(showResult.t);
  showResult.t = setTimeout(() => ($("result").textContent = ""), 2800);
}
function askRoom() {
  $("roomInput").style.display = "inline-block";
  $("setupText").textContent = "Enter the 4-letter code shown on the laptop.";
}

// Switch the controller layout between sports
function applySport() {
  document.body.dataset.sport = sport;
  const golf = sport === "golf";
  $("golfCtl").style.display = golf ? "block" : "none";
  $("aim").style.display = !golf && mode === "motion" && haveTilt ? "block" : "none";
  $("revLbl").textContent = golf ? "Reverse curve" : "Reverse spin";
  if (mode === "motion") {
    pad.classList.remove("swipe");
    pad.innerHTML = golf ? "HOLD &amp; SWING<small>swing it like a golf club</small>" : "HOLD<small>then swing &amp; let go</small>";
  } else {
    pad.classList.add("swipe");
    pad.innerHTML = golf ? "PULL DOWN<small>then flick up to hit</small>" : "SWIPE UP<small>flick to bowl · curve it for spin</small>";
  }
  document.querySelectorAll(".steps").forEach((el) => (el.style.display = el.dataset.sport === sport ? "block" : "none"));
}

// ---------- Motion sensors ----------
let bias = { alpha: 0, beta: 0, gamma: 0 };
let latest = null, samples = [], holding = false, holdStart = 0;

function onMotion(e) {
  const r = e.rotationRate;
  if (!r || r.alpha == null) return;
  const s = { t: performance.now(), alpha: r.alpha - bias.alpha, beta: r.beta - bias.beta, gamma: r.gamma - bias.gamma };
  const prev = latest;
  latest = s;
  if (!holding) return;
  samples.push(s);
  if (sport === "golf" && prev) golfStep(s, (s.t - prev.t) / 1000);
}

// ---------- Tilt-to-aim (bowling) ----------
let haveTilt = false, tiltDeg = 0, aimNow = 0, aimSent = 99, aimLocked = 0;
let curveSign = Number(localStorage.getItem("bowl:spinSign") || 1);

function onOrientation(e) {
  if (e.gamma == null) return;
  haveTilt = true;
  tiltDeg += (e.gamma - tiltDeg) * 0.3;
  const d = Math.abs(tiltDeg) < CONFIG.AIM_DEADZONE_DEG ? 0 : tiltDeg - Math.sign(tiltDeg) * CONFIG.AIM_DEADZONE_DEG;
  aimNow = clampSym(d / (CONFIG.AIM_TILT_MAX_DEG - CONFIG.AIM_DEADZONE_DEG));
  if (!holding) drawAim(aimNow);
}
function drawAim(a) {
  $("aimDot").style.left = `${50 + a * 46}%`;
  $("aimLbl").textContent = Math.abs(a) < 0.05 ? "Straight" : a < 0 ? `Left ${Math.round(-a * 100)}%` : `Right ${Math.round(a * 100)}%`;
}

async function enableMotion() {
  if (!window.isSecureContext) throw new Error("not_https");
  if (!window.DeviceMotionEvent) throw new Error("no_sensor");
  if (typeof DeviceMotionEvent.requestPermission === "function") {
    const res = await DeviceMotionEvent.requestPermission();
    if (res !== "granted") throw new Error("denied");
  }
  if (typeof window.DeviceOrientationEvent?.requestPermission === "function") {
    try { await DeviceOrientationEvent.requestPermission(); } catch {}
  }
  addEventListener("deviceorientation", onOrientation);
  addEventListener("devicemotion", onMotion);
  const t0 = performance.now();
  while (!latest) {
    if (performance.now() - t0 > 1500) { removeEventListener("devicemotion", onMotion); throw new Error("no_data"); }
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function calibrate(ms = 1000) {
  const buf = [];
  const h = (e) => e.rotationRate?.alpha != null && buf.push(e.rotationRate);
  addEventListener("devicemotion", h);
  await new Promise((r) => setTimeout(r, ms));
  removeEventListener("devicemotion", h);
  if (buf.length < 10) return { ok: false, reason: "few_samples" };
  const mean = (k) => buf.reduce((a, r) => a + r[k], 0) / buf.length;
  const m = { alpha: mean("alpha"), beta: mean("beta"), gamma: mean("gamma") };
  const noise = Math.sqrt(buf.reduce((a, r) =>
    a + (r.alpha - m.alpha) ** 2 + (r.beta - m.beta) ** 2 + (r.gamma - m.gamma) ** 2, 0) / buf.length);
  if (noise > CONFIG.STILL_NOISE_MAX) return { ok: false, reason: "moving", noise };
  bias = m;
  return { ok: true, noise, hz: Math.round(buf.length / (ms / 1000)) };
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const clampSym = (x) => Math.max(-1, Math.min(1, x));

function integrate(arr, axis) {
  let deg = 0;
  for (let i = 1; i < arr.length; i++) {
    const dt = (arr[i].t - arr[i - 1].t) / 1000;
    if (dt > 0 && dt < 0.1) deg += arr[i][axis] * dt;
  }
  return deg;
}

// ---------- Bowling: swing -> throw ----------
function extractThrow(buf, holdMs) {
  if (holdMs < CONFIG.MIN_HOLD_MS || buf.length < 8) return { ok: false, reason: "too_short" };
  const mag = buf.map((s) => Math.hypot(s.alpha, s.beta, s.gamma));
  let peak = 0;
  for (let i = 1; i < mag.length - 1; i++) peak = Math.max(peak, (mag[i - 1] + mag[i] + mag[i + 1]) / 3);
  if (peak < CONFIG.POWER_MIN) return { ok: false, reason: "too_gentle", peak };
  const power = 0.2 + 0.8 * clamp01((peak - CONFIG.POWER_MIN) / (CONFIG.POWER_MAX - CONFIG.POWER_MIN));
  const tEnd = buf[buf.length - 1].t;
  const tail = buf.filter((s) => s.t >= tEnd - CONFIG.SPIN_WINDOW_MS);
  const spin = curveSign * clampSym(integrate(tail, CONFIG.SPIN_AXIS) / CONFIG.SPIN_MAX_DEG);
  const aim = haveTilt ? aimLocked : clampSym(integrate(buf, CONFIG.AIM_AXIS) / CONFIG.AIM_MAX_DEG);
  return { ok: true, power, spin, aim };
}

function extractSwipe(pts) {
  if (pts.length < 4) return { ok: false, reason: "short_swipe" };
  const a = pts[0], z = pts[pts.length - 1];
  const dy = a.y - z.y, dx = z.x - a.x;
  if (dy < CONFIG.SWIPE_MIN_PX) return { ok: false, reason: "short_swipe" };
  const recent = pts.filter((p) => p.t >= z.t - 120);
  const r0 = recent[0];
  const speed = Math.hypot(z.x - r0.x, z.y - r0.y) / Math.max(16, z.t - r0.t);
  if (speed < CONFIG.SWIPE_SPEED_MIN) return { ok: false, reason: "too_gentle" };
  const power = 0.2 + 0.8 * clamp01((speed - CONFIG.SWIPE_SPEED_MIN) / (CONFIG.SWIPE_SPEED_MAX - CONFIG.SWIPE_SPEED_MIN));
  const aim = clampSym(Math.atan2(dx, dy) / 0.6);
  const n = pts.length, k = Math.max(2, Math.floor(n / 3));
  const dir = (p, q) => Math.atan2(q.x - p.x, p.y - q.y);
  const spin = clampSym((dir(pts[n - k], z) - dir(a, pts[k - 1])) / 0.9);
  return { ok: true, power, spin, aim };
}

// ---------- Golf: club swing detector ----------
// address -> backswing (angle grows) -> downswing (angle shrinks fast) -> impact (back at address) -> shot fires.
// Power = how far back you swung. Face = how much you twisted the grip between address and impact.
let gs = null;
const isPutter = () => lastTurn?.club === "putter";

function golfReset() {
  gs = { theta: 0, face: 0, sign: 0, top: 0, phase: "address", speeds: [] };
  backswingSent = -1;
}

function golfStep(s, dt) {
  if (!gs || dt <= 0 || dt > 0.1) return;
  const w = s[CONFIG.GOLF_SWING_AXIS];
  gs.theta += w * dt;
  gs.face += s[CONFIG.GOLF_FACE_AXIS] * dt;
  const full = isPutter() ? CONFIG.PUTT_FULL_DEG : CONFIG.GOLF_FULL_DEG;
  const start = isPutter() ? 4 : CONFIG.GOLF_START_DEG;

  if (gs.phase === "address") {
    gs.face *= 0.9; // ignore slow wobble before the swing really begins
    if (Math.abs(gs.theta) > start) { gs.sign = Math.sign(gs.theta); gs.phase = "back"; }
  }
  const a = gs.sign * gs.theta; // angle in the backswing direction
  if (gs.phase === "back") {
    gs.top = Math.max(gs.top, a);
    golfPower = gs.top / full;
    // turned around and coming down with real speed
    if (a < gs.top - (isPutter() ? 3 : 10) && gs.sign * w < -(isPutter() ? 10 : 60)) gs.phase = "down";
  }
  if (gs.phase === "down") {
    gs.speeds.push(Math.abs(w));
    if (a <= (isPutter() ? 2 : CONFIG.GOLF_IMPACT_DEG)) golfImpact();
  }
}

let golfPower = 0, backswingSent = -1;

function golfImpact() {
  const full = isPutter() ? CONFIG.PUTT_FULL_DEG : CONFIG.GOLF_FULL_DEG;
  const power = Math.min(1.3, gs.top / full);
  const recent = gs.speeds.slice(-4);
  const speed = recent.reduce((x, y) => x + y, 0) / Math.max(1, recent.length);
  // the downswing has to be reasonably quick for the backswing you made
  const needed = isPutter() ? 8 + 40 * power : 80 + 220 * Math.min(power, 1);
  let faceDeg = gs.face * gs.sign;     // sign makes it work for left- and right-handed swings
  faceDeg = Math.abs(faceDeg) < CONFIG.GOLF_FACE_DEADZONE ? 0 : faceDeg - Math.sign(faceDeg) * CONFIG.GOLF_FACE_DEADZONE;
  const face = curveSign * clampSym(faceDeg / CONFIG.GOLF_FACE_MAX_DEG);
  const shot = { power, face, speedOk: speed >= needed };
  if (LOGGING) { logSwing(samples); console.log("golf impact", shot, "speed", speed.toFixed(0), "needed", needed.toFixed(0)); }
  holding = false;
  gs = null;
  pad.classList.remove("down");
  if (power < 0.03) return showHint("no_backswing");
  navigator.vibrate?.(35);
  sendThrow(shot);
}

// Touch fallback for golf: drag down = backswing, flick back up past the start = hit
function golfTouch(pts) {
  const a = pts[0], z = pts[pts.length - 1];
  const maxDown = Math.max(...pts.map((p) => p.y - a.y));
  if (maxDown < 15 || z.y > a.y - 10) return { ok: false, reason: "golf_pull" };
  const power = Math.min(1.3, maxDown / (pad.clientHeight * 0.55));
  const recent = pts.filter((p) => p.t >= z.t - 120), r0 = recent[0];
  const speed = (r0.y - z.y) / Math.max(16, z.t - r0.t);
  const lowest = pts.reduce((m, p) => (p.y > m.y ? p : m), a);
  const face = curveSign * clampSym((z.x - lowest.x) / 120);
  return { ok: true, power, face, speedOk: speed > 0.3 };
}

// ---------- Networking ----------
let ws, backoff = 500, rtt = null, lastPong = 0;
const tokenKey = () => `bowl:${room}:token`, seqKey = () => `bowl:${room}:seq`;
let seq = 0;
const pending = new Map();
const sendMsg = (m) => ws?.readyState === 1 && ws.send(JSON.stringify(m));

function connect() {
  seq = Number(localStorage.getItem(seqKey()) || 0);
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.onopen = () => {
    backoff = 500;
    sendMsg({ type: "join", room, token: localStorage.getItem(tokenKey()) });
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    switch (m.type) {
      case "joined":
        localStorage.setItem(tokenKey(), m.token);
        history.replaceState(null, "", `?room=${room}${LOGGING ? "&log=1" : ""}`);
        setPlayer(m.player);
        updateTurnUI();
        flushPending();
        break;
      case "pong": rtt = performance.now() - m.t; lastPong = performance.now(); break;
      case "throw_ack":
        pending.delete(m.seq);
        if (!m.accepted && m.reason !== "duplicate") showHint(m.reason);
        break;
      case "phase":
        phase = m.phase;
        if (m.sport && m.sport !== sport) { sport = m.sport; applySport(); }
        if (phase !== "playing") { myTurn = false; lastTurn = null; if ($("pauseScr").classList.contains("show")) show("play"); }
        updateTurnUI();
        break;
      case "turn":
        phase = "playing";
        if (m.sport && m.sport !== sport) { sport = m.sport; applySport(); }
        lastTurn = m;
        myTurn = m.player === currentPlayer;
        if (sport === "golf") renderGolfInfo(m);
        updateTurnUI();
        if (myTurn) navigator.vibrate?.(40);
        break;
      case "result":
        navigator.vibrate?.(/STRIKE|HOLE IN ONE|Birdie|Eagle/.test(m.label) ? [80, 60, 80, 60, 160] : 30);
        showResult(m);
        break;
      case "paused":
        isPaused = m.paused;
        if (isPaused) { holding = false; gs = null; pad.classList.remove("down"); show("pauseScr"); }
        else if ($("pauseScr").classList.contains("show")) show("play");
        break;
      case "game_over":
        phase = "over"; myTurn = false;
        updateTurnUI();
        $("turnText").textContent = m.winners.includes(currentPlayer) ? "You win! 🎉" : "Game over";
        break;
      case "error":
        ws.onclose = null; ws.close();
        showError(m.code);
        break;
    }
  };
  ws.onclose = (e) => {
    if (e.code === 4000) return showError("opened_elsewhere");
    setStatus("reconnecting");
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 5000);
  };
}

function renderGolfInfo(m) {
  $("gInfo").textContent = `Hole ${m.hole} · Par ${m.par} · ${m.toPin} m to pin · ${m.lie}`;
  $("gClub").innerHTML = `${m.clubName}${m.carry ? `<small>${m.carry} m</small>` : "<small>on the green</small>"}`;
}

function sendThrow(f) {
  const msg = { type: "throw", seq: ++seq };
  for (const [k, v] of Object.entries(f)) if (k !== "ok") msg[k] = typeof v === "number" ? +v.toFixed(3) : v;
  localStorage.setItem(seqKey(), seq);
  pending.set(msg.seq, msg);
  sendMsg(msg);
  myTurn = false;
  updateTurnUI();
  $("turnText").textContent = sport === "golf" ? "Nice swing!" : "Rolling…";
}
function flushPending() { for (const m of pending.values()) sendMsg(m); }
setInterval(flushPending, 1000);

setInterval(() => {
  if (!currentPlayer) return;
  sendMsg({ type: "ping", t: performance.now() });
  const stale = performance.now() - lastPong > 5000;
  setStatus(stale ? "bad" : rtt < 80 ? "good" : rtt < 200 ? "ok" : "bad", rtt);
}, 2000);

// Live data for the laptop: hold glow + aim (bowling), backswing power meter (golf)
setInterval(() => {
  if (ws?.bufferedAmount > 1024) return;
  if (sport === "golf") {
    if (holding && Math.abs(golfPower - backswingSent) > 0.01) {
      backswingSent = golfPower;
      sendMsg({ type: "backswing", v: +golfPower.toFixed(3) });
      $("gPower").textContent = golfPower > 0.02 ? `${Math.round(golfPower * 100)}%` : "";
    }
    return;
  }
  if (holding) sendMsg({ type: "tilt", v: 1 });
  else if (myTurn && mode === "motion" && haveTilt && Math.abs(aimNow - aimSent) > 0.01) {
    aimSent = aimNow;
    sendMsg({ type: "aim", v: +aimNow.toFixed(3) });
  }
}, 50);

// ---------- Input ----------
const pad = $("hold");
let swipePts = [];
const trail = $("trail"), tg = trail.getContext("2d");

pad.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  if (!myTurn) return showHint(phase === "playing" ? "not_your_turn" : "not_started");
  pad.setPointerCapture(e.pointerId);
  holding = true;
  aimLocked = aimNow;
  holdStart = performance.now();
  samples = [];
  golfPower = 0;
  if (sport === "golf") golfReset();
  swipePts = [{ x: e.clientX, y: e.clientY, t: e.timeStamp }];
  pad.classList.add("down");
  navigator.vibrate?.(10);
});

pad.addEventListener("pointermove", (e) => {
  if (!holding || mode !== "touch") return;
  swipePts.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
  if (sport === "golf") {
    const down = Math.max(...swipePts.map((p) => p.y - swipePts[0].y));
    golfPower = Math.min(1.3, Math.max(0, down) / (pad.clientHeight * 0.55));
  }
  drawTrail();
});

pad.addEventListener("pointerup", (e) => {
  if (!holding) return;
  holding = false;
  pad.classList.remove("down");
  $("gPower").textContent = "";
  let res;
  if (mode === "motion") {
    const buf = samples; samples = [];
    if (sport === "golf") {
      // Released before impact: cancel the swing
      gs = null; golfPower = 0;
      sendMsg({ type: "backswing", v: 0 });
      return showHint(buf.length > 10 ? "released" : "no_backswing");
    }
    if (LOGGING) logSwing(buf);
    res = extractThrow(buf, performance.now() - holdStart);
  } else {
    swipePts.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    res = sport === "golf" ? golfTouch(swipePts) : extractSwipe(swipePts);
    if (sport === "golf") { golfPower = 0; sendMsg({ type: "backswing", v: 0 }); }
    setTimeout(() => tg.clearRect(0, 0, trail.width, trail.height), 300);
  }
  if (!res.ok) return showHint(res.reason);
  navigator.vibrate?.(25);
  sendThrow(res);
});

pad.addEventListener("pointercancel", () => { holding = false; samples = []; gs = null; pad.classList.remove("down"); });

function drawTrail() {
  trail.width = innerWidth; trail.height = innerHeight;
  tg.strokeStyle = "rgba(255,255,255,.85)"; tg.lineWidth = 10; tg.lineCap = tg.lineJoin = "round";
  tg.beginPath();
  swipePts.forEach((p, i) => (i ? tg.lineTo(p.x, p.y) : tg.moveTo(p.x, p.y)));
  tg.stroke();
}

// Golf buttons: aim and club (hold to repeat aim)
function repeatButton(el, fn) {
  let timer;
  const stop = () => clearInterval(timer);
  el.addEventListener("pointerdown", (e) => { e.preventDefault(); if (!myTurn) return; fn(); timer = setInterval(fn, 120); });
  el.addEventListener("pointerup", stop); el.addEventListener("pointerleave", stop); el.addEventListener("pointercancel", stop);
}
repeatButton($("aimL"), () => sendMsg({ type: "golf_cmd", cmd: "aim", d: -1 }));
repeatButton($("aimR"), () => sendMsg({ type: "golf_cmd", cmd: "aim", d: 1 }));
$("clubPrev").addEventListener("click", () => myTurn && sendMsg({ type: "golf_cmd", cmd: "club", d: -1 }));
$("clubNext").addEventListener("click", () => myTurn && sendMsg({ type: "golf_cmd", cmd: "club", d: 1 }));

// ---------- Settings ----------
const revBox = $("revSpin");
revBox.checked = curveSign < 0;
revBox.addEventListener("change", () => {
  curveSign = revBox.checked ? -1 : 1;
  localStorage.setItem("bowl:spinSign", curveSign);
});
$("helpBtn").addEventListener("click", () => { applySport(); show("howto"); });
// Pause / exit menu: opening it pauses the game for everyone
$("menuBtn").addEventListener("click", () => {
  if (phase !== "playing") return showHint("not_started");
  sendMsg({ type: "menu", action: "pause" });
});
$("pResume").addEventListener("click", () => sendMsg({ type: "menu", action: "resume" }));
$("pRestart").addEventListener("click", () => confirm("Restart this game from the beginning?") && sendMsg({ type: "menu", action: "restart" }));
$("pQuit").addEventListener("click", () => confirm("Quit to the menu? This game's score will be lost.") && sendMsg({ type: "menu", action: "quit" }));
$("howtoClose").addEventListener("click", () => show(currentPlayer ? "play" : "setup"));

// ---------- Screen wake lock ----------
async function keepAwake() { try { await navigator.wakeLock?.request("screen"); } catch {} }
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && keepAwake());

// ---------- Setup ----------
if (!room) askRoom();

$("enable").addEventListener("click", async () => {
  if (!room) {
    room = $("roomInput").value.trim().toUpperCase();
    if (room.length !== 4) return ($("setupErr").textContent = "Enter the 4-letter code.");
  }
  $("setupErr").textContent = "";
  try {
    await enableMotion();
    show("calib");
    let cal, tries = 0;
    do cal = await calibrate(); while (!cal.ok && ++tries < 2);
    console.log("calibration", cal);
  } catch (err) {
    mode = "touch";
    const why = {
      not_https: "Swing needs an https:// link. Scan the QR from the tunnel page.",
      no_sensor: "This browser has no motion sensors.",
      denied: "Motion access was denied. Close the browser fully, reopen the link and tap Allow.",
      no_data: "Phone didn't send motion data. Try Chrome (Android) or Safari (iPhone).",
    }[err.message] || "Motion unavailable: " + err.message;
    $("why").textContent = "Touch mode: " + why;
  }
  applySport();
  keepAwake();
  show("play");
  connect();
});

// ---------- Logger for tuning (?log=1, then tap the result line to download) ----------
const swings = [];
let swingId = 0;
function logSwing(buf) {
  swingId++;
  const t0 = buf[0]?.t ?? 0;
  for (const s of buf) swings.push([swingId, sport, (s.t - t0).toFixed(1), s.alpha.toFixed(2), s.beta.toFixed(2), s.gamma.toFixed(2)]);
}
window.downloadCsv = () => {
  const csv = "swing,sport,t,alpha,beta,gamma\n" + swings.map((r) => r.join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "swings.csv";
  a.click();
};
if (LOGGING) $("result").addEventListener("click", window.downloadCsv);
