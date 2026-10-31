// Golf game module for the laptop: turn flow, top-down course renderer, live power meter.
import { HOLES, CLUBS, clubById, Shot, surfaceAt, SURFACE, autoClub, previewLanding, headingTo, dist, scoreName, inShape, puttRange } from "../golf.js";

const TEE_AIM = { 1: [10, 210], 2: [-14, 222] }; // hole index -> safer tee-shot target for doglegs
const MAX_STROKES = 10;
const COL = {
  oob: "#3f8f3a", rough: "#6cbf4f", fairway: "#8fdc5e", stripe: "rgba(255,255,255,.07)", fringe: "#9be667", green: "#b2f07a",
  sand: "#f3e3a1", sandEdge: "#e2cd80", water: "#4fb6f0", waterEdge: "#8fd6ff", tee: "#a3e874",
};

export class GolfGame {
  constructor(ctx) {
    this.ctx = ctx;
    this.c = ctx.canvas;
    this.g = this.c.getContext("2d");
    this.cam = { x: 0, y: 0, rot: 0, s: 3 };
    this.backswing = 0; this.backswingUntil = 0;
    this.over = false;
  }

  get active() { return this.cur; }
  get hole() { return HOLES[this.holeIdx]; }

  start(order) {
    this.order = order;
    this.card = Object.fromEntries(order.map((p) => [p, []]));
    this.over = false;
    this.startHole(0);
  }

  startHole(i) {
    this.holeIdx = i;
    const h = this.hole;
    const ang = Math.random() * Math.PI * 2, sp = Math.round(Math.random() * 50) / 10;
    this.wind = { x: Math.sin(ang) * sp, y: Math.cos(ang) * sp, speed: sp };
    this.players = Object.fromEntries(this.order.map((p) => [p, { pos: [...h.tee], strokes: 0, holed: false, lie: "tee" }]));
    this.shot = null; this.busy = false;
    this.trees = makeTrees(h, i + 1);
    this.ctx.ui.pop(`Hole ${i + 1} · Par ${h.par}`);
    this.nextTurn(true);
  }

  // Farthest from the hole plays next (ties: player order)
  nextTurn(snap = false) {
    const h = this.hole;
    const left = this.order.filter((p) => !this.players[p].holed);
    if (!left.length) return this.endHole();
    this.cur = left.reduce((a, b) => (dist(this.players[b].pos, h.pin) > dist(this.players[a].pos, h.pin) + 0.01 ? b : a));
    const pl = this.players[this.cur];
    const target = pl.lie === "tee" && TEE_AIM[this.holeIdx] ? TEE_AIM[this.holeIdx] : h.pin;
    pl.heading = headingTo(pl.pos, target);
    pl.club = autoClub(dist(pl.pos, target), pl.lie);
    this.backswing = 0;
    this.busy = false;
    if (snap) Object.assign(this.cam, this.camTarget());
    this.sendTurn();
  }

  turnMsg() {
    const p = this.cur, pl = this.players[p], h = this.hole, c = clubById(pl.club);
    return {
      type: "turn", sport: "golf", player: p, hole: this.holeIdx + 1, par: h.par, stroke: pl.strokes + 1,
      club: pl.club, clubName: c.name, carry: c.carry, toPin: Math.round(dist(pl.pos, h.pin)), lie: SURFACE[pl.lie].label,
    };
  }

  sendTurn(to) {
    const m = this.turnMsg();
    this.ctx.send(to ? { ...m, to } : m);
    this.ctx.ui.banner(`Player ${m.player} · ${m.toPin} m to the pin — ${this.ctx.connected[m.player] ? "take your swing!" : "Space to swing"}`, m.player, true);
    this.renderBoard();
    this.renderInfo();
  }

  handleThrow(m) {
    if (![m.power, m.face].every(Number.isFinite)) return { accepted: false, reason: "invalid" };
    if (this.over || m.player !== this.cur || this.busy) return { accepted: false, reason: "not_your_turn" };
    this.hit({ power: Math.max(0, Math.min(1.3, m.power)), face: Math.max(-1, Math.min(1, m.face)), speedOk: m.speedOk !== false });
    return { accepted: true };
  }

  hit(swing) {
    const pl = this.players[this.cur];
    this.busy = true;
    pl.strokes++;
    pl.prev = [...pl.pos];
    this.shot = new Shot(this.hole, pl.pos, pl.heading, pl.club, swing, pl.lie, this.wind);
    this.shotHeading = pl.heading;
    this.backswing = 0;
    this.ctx.ui.banner(null, null, false);
    this.renderInfo();
  }

  onMsg(m) {
    if (m.player !== this.cur || this.busy || this.over) return;
    const pl = this.players[this.cur];
    if (m.type === "backswing" && Number.isFinite(m.v)) { this.backswing = Math.max(0, Math.min(1.3, m.v)); this.backswingUntil = performance.now() + 400; }
    if (m.type === "golf_cmd") {
      if (m.cmd === "aim") pl.heading += Math.sign(m.d) * (pl.club === "putter" ? 0.5 : 1.5) * Math.PI / 180;
      if (m.cmd === "club") {
        const list = CLUBS.filter((c) => (pl.lie === "green" ? true : c.id !== "putter"));
        const i = list.findIndex((c) => c.id === pl.club);
        pl.club = list[(i + Math.sign(m.d) + list.length) % list.length].id;
        this.sendTurn(this.cur);
      }
      this.renderInfo();
    }
  }

  key(e) {
    if (this.over || this.busy) return;
    const pl = this.players[this.cur];
    if (e.code === "ArrowLeft" || e.code === "ArrowRight") this.onMsg({ type: "golf_cmd", cmd: "aim", d: e.code === "ArrowLeft" ? -1 : 1, player: this.cur });
    else if (e.code === "ArrowUp" || e.code === "ArrowDown") this.onMsg({ type: "golf_cmd", cmd: "club", d: e.code === "ArrowUp" ? -1 : 1, player: this.cur });
    else if (e.code === "Space") {
      e.preventDefault();
      const d = dist(pl.pos, this.hole.pin), c = clubById(pl.club);
      const full = pl.club === "putter" ? puttRange(d) : (c.carry * SURFACE[pl.lie].carry + c.roll * 0.6);
      const power = Math.min(1.05, d / full) * (0.92 + Math.random() * 0.14);
      this.hit({ power, face: (Math.random() - 0.5) * 0.4, speedOk: true });
    } else return;
    e.preventDefault();
  }

  shotDone() {
    const s = this.shot, p = this.cur, pl = this.players[p], h = this.hole;
    let label, extra = "";
    if (s.result === "holed") {
      pl.holed = true; pl.pos = [...h.pin];
      label = scoreName(pl.strokes, h.par);
      if (pl.strokes <= h.par - 1) this.ctx.ui.confetti();
    } else if (s.result === "water") {
      pl.strokes++; pl.pos = s.dropPos; pl.lie = surfaceAt(h, ...pl.pos); label = "Splash!"; extra = "+1 penalty";
    } else if (s.result === "oob") {
      pl.strokes++; pl.pos = pl.prev; label = "Out of bounds"; extra = "+1 penalty";
    } else {
      pl.pos = s.pos; pl.lie = s.result;
      const carried = Math.round(dist(pl.prev, pl.pos));
      label = s.mishit || (s.result === "green" && pl.prev && surfaceAt(h, ...pl.prev) !== "green" ? "On the green!" : `${carried} m`);
      extra = SURFACE[s.result].label;
    }
    if (!pl.holed && pl.strokes >= MAX_STROKES) { pl.holed = true; pl.strokes = MAX_STROKES; label = "Picked up"; }
    this.ctx.ui.pop(label);
    this.ctx.send({ type: "result", label: extra ? `${label} · ${extra}` : label, to: p });
    this.renderBoard();
    setTimeout(() => { this.shot = null; this.nextTurn(); }, 1800);
  }

  endHole() {
    for (const p of this.order) this.card[p][this.holeIdx] = this.players[p].strokes;
    this.renderBoard();
    if (this.holeIdx + 1 < HOLES.length) {
      this.busy = true;
      this.ctx.ui.banner(`Hole ${this.holeIdx + 1} done! Next hole coming up…`, this.order[0], false);
      setTimeout(() => this.startHole(this.holeIdx + 1), 2600);
    } else this.end();
  }

  end() {
    this.over = true;
    const par = HOLES.reduce((a, h) => a + h.par, 0);
    const totals = this.order.map((p) => {
      const v = this.card[p].reduce((a, b) => a + b, 0);
      return { p, value: v, sub: rel(v - par) };
    });
    const best = Math.min(...totals.map((t) => t.value));
    this.ctx.ui.gameOver({ totals, winners: totals.filter((t) => t.value === best).map((t) => t.p), unit: "strokes", low: true });
  }

  renderBoard() {
    const C = this.ctx.colors;
    const head = `<div class="row golfhead"><div class="chip"></div>${HOLES.map((h, i) =>
      `<div class="gcell head ${i === this.holeIdx && !this.over ? "now" : ""}">H${i + 1}<small>Par ${h.par}</small></div>`).join("")}<div class="total small">Total</div></div>`;
    const rows = this.order.map((p) => {
      const cells = HOLES.map((h, i) => {
        let v = this.card[p][i];
        if (v == null && i === this.holeIdx && this.players?.[p]) v = this.players[p].strokes || "";
        const cls = this.card[p][i] == null ? "" : v < h.par ? "under" : v > h.par ? "overpar" : "";
        return `<div class="gcell ${cls}">${v ?? ""}</div>`;
      }).join("");
      const tot = this.card[p].reduce((a, b) => a + (b || 0), 0);
      const parSoFar = HOLES.slice(0, this.card[p].filter((x) => x != null).length).reduce((a, h) => a + h.par, 0);
      return `<div class="row ${p === this.cur && !this.over ? "active" : ""}"><div class="chip" style="background:${C[p]}">P${p}</div>${cells}<div class="total">${tot ? rel(tot - parSoFar) : "E"}</div></div>`;
    }).join("");
    this.ctx.ui.board(head + rows);
  }

  renderInfo() {
    const pl = this.players[this.cur], h = this.hole;
    if (!pl) return;
    const wdeg = (Math.atan2(this.wind.x, this.wind.y) - pl.heading) * 180 / Math.PI;
    this.ctx.ui.info(`
      <div class="ihole">Hole ${this.holeIdx + 1}<span>Par ${h.par} · ${h.name}</span></div>
      <div class="irow"><b>${clubById(pl.club).name}</b> · ${Math.round(dist(pl.pos, h.pin))} m to pin</div>
      <div class="irow">Lie: ${SURFACE[pl.lie].label} · Stroke ${pl.strokes + (this.busy ? 0 : 1)}</div>
      <div class="irow wind"><span class="arrow" style="transform:rotate(${wdeg}deg)">↑</span> Wind ${this.wind.speed.toFixed(1)} m/s</div>`);
  }

  // ---------- Camera & drawing ----------
  camTarget() {
    const pl = this.players[this.cur], h = this.hole, W = this.c.clientWidth, H = this.c.clientHeight;
    const d = dist(pl.pos, h.pin);
    const putting = pl.club === "putter";
    const reach = putting ? Math.max(6, Math.min(d * 1.3, 30)) : Math.min(clubById(pl.club).carry * 1.1 + 20, Math.max(d + 25, 60));
    const span = reach + (putting ? 6 : 30);
    const s = (H * 0.78) / span;
    // centre so the ball sits near the bottom of the screen
    const off = span / 2 - (putting ? 3 : 15);
    return { x: pl.pos[0] + Math.sin(pl.heading) * off, y: pl.pos[1] + Math.cos(pl.heading) * off, rot: pl.heading, s: Math.min(s, W / 40) };
  }

  frame(dt, now) {
    if (this.shot && !this.shot.done) { this.shot.step(dt); if (this.shot.done) this.shotDone(); }
    const k = 1 - Math.exp(-dt * 3);
    let t;
    if (this.shot) {
      const s = this.shot;
      const look = s.phase === "flight" ? 25 : 8;
      t = { x: s.pos[0] + Math.sin(this.shotHeading) * look, y: s.pos[1] + Math.cos(this.shotHeading) * look, rot: this.shotHeading, s: Math.max(this.cam.s * 0.995, 2.2) };
      if (s.phase !== "flight") t.s = this.cam.s;
    } else if (this.players?.[this.cur]) t = this.camTarget();
    if (t) {
      this.cam.x += (t.x - this.cam.x) * k * 1.5; this.cam.y += (t.y - this.cam.y) * k * 1.5;
      let dr = t.rot - this.cam.rot; dr = Math.atan2(Math.sin(dr), Math.cos(dr));
      this.cam.rot += dr * k * 1.5; this.cam.s += (t.s - this.cam.s) * k;
    }
    if (now > this.backswingUntil) this.backswing = 0;
    this.draw(now);
  }

  draw(now) {
    const g = this.g, W = this.c.clientWidth, H = this.c.clientHeight, cam = this.cam, h = this.hole;
    const dpr = this.c.width / W;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = COL.oob; g.fillRect(0, 0, W, H);

    // world transform: heading points up the screen
    g.save();
    g.translate(W / 2, H / 2); g.scale(cam.s, -cam.s); g.rotate(cam.rot); g.translate(-cam.x, -cam.y);
    const b = h.bounds;
    g.fillStyle = COL.rough; roundRect(g, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 12); g.fill();

    // fairway with mowing stripes
    const fw = new Path2D();
    for (const s of h.fairway) capsulePath(fw, s);
    g.fillStyle = COL.fairway; g.fill(fw);
    g.save(); g.clip(fw); g.fillStyle = COL.stripe;
    for (let y = b.y0; y < b.y1; y += 16) g.fillRect(b.x0, y, b.x1 - b.x0, 8);
    g.restore();
    // tee box
    g.fillStyle = COL.tee; g.fillRect(h.tee[0] - 5, h.tee[1] - 4, 10, 8);
    // green + fringe
    const gr = h.green;
    g.fillStyle = COL.fringe; g.beginPath(); g.ellipse(gr.c[0], gr.c[1], gr.rx + 2.5, gr.ry + 2.5, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = COL.green; g.beginPath(); g.ellipse(gr.c[0], gr.c[1], gr.rx, gr.ry, 0, 0, Math.PI * 2); g.fill();
    // sand
    for (const s of h.sand) {
      g.fillStyle = COL.sandEdge; g.beginPath(); g.ellipse(s.c[0], s.c[1], s.rx + 0.8, s.ry + 0.8, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = COL.sand; g.beginPath(); g.ellipse(s.c[0], s.c[1], s.rx, s.ry, 0, 0, Math.PI * 2); g.fill();
    }
    // water with a shimmer
    for (const s of h.water) {
      const p = new Path2D();
      if (s.rx != null) p.ellipse(s.c[0], s.c[1], s.rx, s.ry, 0, 0, Math.PI * 2); else p.rect(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0);
      g.fillStyle = COL.waterEdge; g.save(); g.lineWidth = 2.4; g.strokeStyle = COL.waterEdge; g.stroke(p); g.restore();
      g.fillStyle = COL.water; g.fill(p);
      g.save(); g.clip(p); g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = 0.5;
      const ph = (now / 1000) % 6;
      for (let y = b.y0; y < b.y1; y += 6) { g.beginPath(); g.moveTo(b.x0, y + ph); g.lineTo(b.x1, y + ph + 2); g.stroke(); }
      g.restore();
    }
    // cup
    g.fillStyle = "#1d2b1a"; g.beginPath(); g.arc(h.pin[0], h.pin[1], Math.max(0.12, 3.5 / cam.s), 0, Math.PI * 2); g.fill();
    // trees (outside bounds)
    for (const t of this.trees) {
      g.fillStyle = "rgba(0,0,0,.18)"; g.beginPath(); g.arc(t.x + 1.5, t.y - 1.5, t.r, 0, Math.PI * 2); g.fill();
      g.fillStyle = t.c; g.beginPath(); g.arc(t.x, t.y, t.r, 0, Math.PI * 2); g.fill();
      g.fillStyle = "rgba(255,255,255,.12)"; g.beginPath(); g.arc(t.x - t.r * 0.3, t.y + t.r * 0.3, t.r * 0.45, 0, Math.PI * 2); g.fill();
    }

    // aim line and live target marker
    const pl = this.players[this.cur];
    if (!this.shot && pl && !this.over && !this.busy) {
      const live = this.backswing > 0.02;
      const pw = live ? this.backswing : 1;
      const tgt = previewLanding(h, pl.pos, pl.heading, pl.club, pw, pl.lie);
      g.save();
      g.strokeStyle = live ? "rgba(255,255,255,.95)" : "rgba(255,255,255,.55)";
      g.lineWidth = Math.max(0.25, 3 / cam.s); g.setLineDash([6 / cam.s, 6 / cam.s]);
      g.beginPath(); g.moveTo(pl.pos[0], pl.pos[1]); g.lineTo(tgt.x, tgt.y); g.stroke(); g.setLineDash([]);
      const r = pl.club === "putter" ? 0.6 : Math.max(2.5, 10 / cam.s * 1.5);
      g.strokeStyle = this.backswing > 1 ? "#ff4d5e" : "#ffcc33"; g.lineWidth = Math.max(0.2, 3 / cam.s);
      g.beginPath(); g.arc(tgt.x, tgt.y, r, 0, Math.PI * 2); g.stroke();
      g.fillStyle = this.backswing > 1 ? "rgba(255,77,94,.25)" : "rgba(255,204,51,.25)"; g.fill();
      g.restore();
    }
    g.restore();

    // flag (screen space so it always stands up)
    const fp = this.toScreen(h.pin[0], h.pin[1]);
    const ph = Math.max(22, Math.min(70, cam.s * 3));
    g.strokeStyle = "#f4f4f4"; g.lineWidth = 2.5; g.beginPath(); g.moveTo(fp.x, fp.y); g.lineTo(fp.x, fp.y - ph); g.stroke();
    const wave = Math.sin(now / 200) * 2;
    g.fillStyle = "#ff4d5e"; g.beginPath(); g.moveTo(fp.x, fp.y - ph); g.lineTo(fp.x + ph * 0.5, fp.y - ph * 0.82 + wave); g.lineTo(fp.x, fp.y - ph * 0.64); g.fill();

    // balls: resting ones first, then the moving / active one
    for (const p of this.order) {
      const q = this.players[p];
      if (q.holed || (this.shot && p === this.cur)) continue;
      this.ball(q.pos, 0, this.ctx.colors[p], p === this.cur);
    }
    if (this.shot) this.ball(this.shot.pos, this.shot.h, this.ctx.colors[this.cur], true);

    if (this.backswing > 0.02 && !this.shot) this.powerMeter(W, H);
  }

  toScreen(x, y) {
    const c = this.cam, dx = x - c.x, dy = y - c.y;
    const xr = dx * Math.cos(c.rot) - dy * Math.sin(c.rot), yr = dx * Math.sin(c.rot) + dy * Math.cos(c.rot);
    return { x: this.c.clientWidth / 2 + xr * c.s, y: this.c.clientHeight / 2 - yr * c.s };
  }

  ball(pos, height, color, active) {
    const g = this.g, p = this.toScreen(pos[0], pos[1]);
    const r = 6 * (1 + height / 18);
    g.fillStyle = "rgba(0,0,0,.25)"; g.beginPath(); g.ellipse(p.x + height * 0.6, p.y + 2, 6, 3.5, 0, 0, Math.PI * 2); g.fill();
    const y = p.y - height * 2.2;
    if (active) { g.strokeStyle = color; g.lineWidth = 4; g.beginPath(); g.arc(p.x, y, r + 4, 0, Math.PI * 2); g.stroke(); }
    const grad = g.createRadialGradient(p.x - r * 0.3, y - r * 0.3, 1, p.x, y, r);
    grad.addColorStop(0, "#fff"); grad.addColorStop(1, "#d9dee8");
    g.fillStyle = grad; g.beginPath(); g.arc(p.x, y, r, 0, Math.PI * 2); g.fill();
  }

  powerMeter(W, H) {
    const g = this.g, x = 40, y0 = H - 120, hgt = Math.min(320, H * 0.45), w = 26;
    const top = y0 - hgt;
    g.fillStyle = "rgba(255,255,255,.85)"; roundRectS(g, x - 8, top - 30, w + 16, hgt + 64, 16); g.fill();
    g.fillStyle = "#e3e8ef"; roundRectS(g, x, top, w, hgt, 10); g.fill();
    const full = hgt / 1.3;
    const v = Math.min(1.3, this.backswing);
    g.fillStyle = v > 1 ? "#ff4d5e" : v > 0.85 ? "#ffcc33" : "#3ccf6e";
    roundRectS(g, x, y0 - v * full, w, v * full, 10); g.fill();
    g.strokeStyle = "#24324a"; g.lineWidth = 3;
    g.beginPath(); g.moveTo(x - 6, y0 - full); g.lineTo(x + w + 6, y0 - full); g.stroke();
    g.fillStyle = "#24324a"; g.font = "700 16px Fredoka, system-ui"; g.textAlign = "center";
    g.fillText(`${Math.round(v * 100)}%`, x + w / 2, y0 + 24);
    g.fillText("POWER", x + w / 2, top - 10);
  }
}

// ---------- helpers ----------
const rel = (d) => (d === 0 ? "E" : d > 0 ? `+${d}` : `${d}`);

function capsulePath(p, s) {
  const [ax, ay] = s.a, [bx, by] = s.b, r = s.w / 2;
  const ang = Math.atan2(by - ay, bx - ax);
  p.moveTo(ax + Math.cos(ang + Math.PI / 2) * r, ay + Math.sin(ang + Math.PI / 2) * r);
  p.arc(ax, ay, r, ang + Math.PI / 2, ang + Math.PI * 1.5);
  p.arc(bx, by, r, ang - Math.PI / 2, ang + Math.PI / 2);
  p.closePath();
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
function roundRectS(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, Math.max(0, h), Math.min(r, Math.max(0, h) / 2)); }

function makeTrees(h, seed) {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const b = h.bounds, trees = [];
  const cols = ["#2f7d32", "#358a38", "#2a7030", "#3b9a3d"];
  for (let i = 0; i < 260; i++) {
    const x = b.x0 - 60 + rnd() * (b.x1 - b.x0 + 120), y = b.y0 - 60 + rnd() * (b.y1 - b.y0 + 120);
    const inside = x > b.x0 - 3 && x < b.x1 + 3 && y > b.y0 - 3 && y < b.y1 + 3;
    if (inside) continue;
    trees.push({ x, y, r: 4 + rnd() * 4, c: cols[i % cols.length] });
  }
  return trees;
}
