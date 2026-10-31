// Pseudo-3D lane renderer on a 2D canvas. Perspective camera behind the bowler.
import { LANE, BALL_R } from "./physics.js";

// Pin silhouette: [height, radius] in metres
const PIN_PROFILE = [[0, .026], [.03, .042], [.08, .058], [.12, .060], [.17, .052], [.22, .034], [.25, .023],
  [.28, .023], [.31, .030], [.345, .030], [.37, .020], [.381, 0]];

export class Renderer {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext("2d");
    this.cam = { x: 0, h: 1.35, z: -2.4 };
    this.resize();
    addEventListener("resize", () => this.resize());
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.W = this.c.clientWidth; this.H = this.c.clientHeight;
    this.c.width = this.W * dpr; this.c.height = this.H * dpr;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // world -> screen. Returns null if behind the camera.
  P(x, y, z) {
    const d = z - this.cam.z;
    if (d < 0.15) return null;
    const f = this.H * 1.05;
    const hz = this.H * 0.30;
    return { x: this.W / 2 + ((x - this.cam.x) * f) / d, y: hz + ((this.cam.h - y) * f) / d, s: f / d };
  }

  quad(x0, x1, z0, z1, fill, y = 0) {
    z0 = Math.max(z0, this.cam.z + 0.2);
    if (z1 <= z0) return;
    const a = this.P(x0, y, z0), b = this.P(x1, y, z0), c = this.P(x1, y, z1), d = this.P(x0, y, z1);
    const g = this.g;
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.lineTo(d.x, d.y); g.closePath();
    g.fillStyle = fill; g.fill();
  }

  wall(x, z0, z1, h, fill) { // vertical wall along z at x
    z0 = Math.max(z0, this.cam.z + 0.2);
    const a = this.P(x, 0, z0), b = this.P(x, 0, z1), c = this.P(x, h, z1), d = this.P(x, h, z0);
    const g = this.g;
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.lineTo(d.x, d.y); g.closePath();
    g.fillStyle = fill; g.fill();
  }

  draw(lane, opts = {}) {
    const { g, W, H } = this;
    const hw = LANE.halfWidth, gw = LANE.gutter, end = LANE.pitZ;

    // Sky / arena backdrop
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#8fd0ff"); sky.addColorStop(0.45, "#cdeeff"); sky.addColorStop(1, "#eaf6ff");
    g.fillStyle = sky; g.fillRect(0, 0, W, H);

    // Back wall with a friendly masking panel
    const bwL = this.P(-6, 3.2, end + 0.3), bwR = this.P(6, 0, end + 0.3);
    g.fillStyle = "#5b7cfa"; g.fillRect(bwL.x, bwL.y, bwR.x - bwL.x, bwR.y - bwL.y);
    const stripe = this.P(-6, 1.6, end + 0.3), stripe2 = this.P(6, 1.25, end + 0.3);
    g.fillStyle = "#ffcc33"; g.fillRect(stripe.x, stripe.y, stripe2.x - stripe.x, stripe2.y - stripe.y);
    for (let i = -3; i <= 3; i++) { // decorative circles
      const p = this.P(i * 1.6, 2.4, end + 0.29);
      g.fillStyle = i % 2 ? "rgba(255,255,255,.25)" : "rgba(255,107,107,.55)";
      g.beginPath(); g.arc(p.x, p.y, p.s * 0.35, 0, Math.PI * 2); g.fill();
    }

    // Floor around the lanes, neighbouring lanes
    this.quad(-8, 8, -3, end + 0.3, "#e9d2ad");
    for (const off of [-1.85, 1.85]) {
      this.quad(off - hw - gw, off + hw + gw, -3, end, "#c9ccd6");
      this.quad(off - hw, off + hw, -3, end, "#f2d9b0");
    }
    this.quad(-hw - gw - 0.25, hw + gw + 0.25, -3, end, "#b8c0cf"); // ball-return caps

    // Gutters
    this.quad(-hw - gw, -hw, -3, end, "#8e98ab");
    this.quad(hw, hw + gw, -3, end, "#8e98ab");

    // Lane wood, approach, pin deck
    this.quad(-hw, hw, -3, 0, "#f7e3bf");
    const nearZ = Math.max(0, this.cam.z + 0.2);
    const a = this.P(-hw, 0, nearZ), b = this.P(hw, 0, nearZ), c = this.P(hw, 0, end), d = this.P(-hw, 0, end);
    const wood = g.createLinearGradient(0, a.y, 0, d.y);
    wood.addColorStop(0, "#f3cf96"); wood.addColorStop(1, "#ffe9c4");
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.lineTo(d.x, d.y); g.closePath();
    g.fillStyle = wood; g.fill();
    this.quad(-hw, hw, LANE.length - 0.35, end, "rgba(255,255,255,.35)");

    // Boards
    g.strokeStyle = "rgba(160,110,50,.13)"; g.lineWidth = 1;
    for (let i = 1; i < 39; i++) {
      const x = -hw + (i * 2 * hw) / 39;
      const p0 = this.P(x, 0, nearZ), p1 = this.P(x, 0, end);
      g.beginPath(); g.moveTo(p0.x, p0.y); g.lineTo(p1.x, p1.y); g.stroke();
    }
    // Foul line
    this.quad(-hw - gw, hw + gw, -0.02, 0.02, "#ff6b6b");
    // Guide dots and arrows
    for (const bd of [3, 5, 8, 11, 14]) for (const s of [-1, 1]) {
      const p = this.P(s * (hw - (bd * 2 * hw) / 39), 0, 2.1);
      if (p) { g.fillStyle = "#7a5a33"; g.beginPath(); g.ellipse(p.x, p.y, p.s * 0.012, p.s * 0.006, 0, 0, Math.PI * 2); g.fill(); }
    }
    for (let k = -3; k <= 3; k++) {
      const x = k * 5 * (2 * hw / 39), z = 4.6 + Math.abs(k) * 0.3;
      const t = this.P(x, 0, z + 0.25), l = this.P(x - 0.025, 0, z), r = this.P(x + 0.025, 0, z);
      if (t && l && r) { g.fillStyle = k === 0 ? "#ff6b6b" : "#5b7cfa"; g.beginPath(); g.moveTo(t.x, t.y); g.lineTo(l.x, l.y); g.lineTo(r.x, r.y); g.fill(); }
    }

    // Pit and kickbacks
    this.quad(-hw - gw, hw + gw, end, end + 0.3, "#2b3550");
    this.wall(-hw - gw, LANE.length - 1.2, end + 0.3, 0.5, "#4c5f8f");
    this.wall(hw + gw, LANE.length - 1.2, end + 0.3, 0.5, "#4c5f8f");

    // Aim guide: where the ball will go if thrown straight (matches physics: angle = aim * 0.03 rad)
    if (opts.guide && lane.ball == null) {
      const ang = (opts.aim || 0) * 0.03;
      const z0 = Math.max(0.5, this.cam.z + 0.3), z1 = LANE.length - 0.3;
      const xAt = (z) => Math.max(-hw, Math.min(hw, (z - 0.3) * Math.tan(ang)));
      const p0 = this.P(xAt(z0), 0.005, z0), p1 = this.P(xAt(z1), 0.005, z1);
      if (p0 && p1) {
        g.setLineDash([10, 12]); g.lineCap = "round";
        g.strokeStyle = "rgba(255,255,255,.9)"; g.lineWidth = 5;
        g.beginPath(); g.moveTo(p0.x, p0.y); g.lineTo(p1.x, p1.y); g.stroke();
        g.setLineDash([]);
        // target marker at the pins
        g.fillStyle = "rgba(255,204,51,.95)";
        g.beginPath(); g.ellipse(p1.x, p1.y, p1.s * 0.06, p1.s * 0.02, 0, 0, Math.PI * 2); g.fill();
      }
    }

    // Sprites, far to near
    const items = lane.pins
      .filter((p) => !p.gone || (p.pitT != null && lane.time - p.pitT < 0.6)) // pins tumbling into the pit
      .map((p) => ({ z: p.z, draw: () => this.pin(p, p.gone ? (lane.time - p.pitT) * 1.2 : 0) }));
    const ball = lane.ball ?? (opts.idleBall ? { x: 0, z: 0.3, roll: opts.t * 0.6, idle: true } : null);
    if (ball && !ball.inPit) items.push({ z: ball.z, draw: () => this.ball(ball, opts.ballColor || "#5b7cfa", opts.glow) });
    items.sort((a, b) => b.z - a.z).forEach((i) => i.draw());
  }

  pin(p, drop = 0) {
    const base = this.P(p.x, -drop, p.z);
    if (!base) return;
    const g = this.g, s = base.s;
    // shadow
    g.fillStyle = "rgba(60,40,20,.18)";
    g.beginPath(); g.ellipse(base.x, base.y, s * 0.07, s * 0.022, 0, 0, Math.PI * 2); g.fill();

    g.save();
    g.translate(base.x, base.y);
    if (p.fallen) {
      const side = Math.sin(p.fallDir), fwd = Math.cos(p.fallDir);
      if (Math.abs(side) > 0.35) g.rotate(Math.sign(side) * p.fallT * Math.PI / 2);
      else g.scale(1, 1 - p.fallT * (fwd > 0 ? 0.75 : 0.6));
    }
    const path = new Path2D();
    PIN_PROFILE.forEach(([h, r], i) => (i ? path.lineTo(r * s, -h * s) : path.moveTo(r * s, -h * s)));
    for (let i = PIN_PROFILE.length - 1; i >= 0; i--) path.lineTo(-PIN_PROFILE[i][1] * s, -PIN_PROFILE[i][0] * s);
    path.closePath();
    const body = g.createLinearGradient(-0.06 * s, 0, 0.06 * s, 0);
    body.addColorStop(0, "#ffffff"); body.addColorStop(0.55, "#f4f4f6"); body.addColorStop(1, "#c9cfda");
    g.fillStyle = body; g.fill(path);
    g.save(); g.clip(path);
    g.fillStyle = "#ff4d5e";
    g.fillRect(-0.07 * s, -0.262 * s, 0.14 * s, 0.012 * s);
    g.fillRect(-0.07 * s, -0.292 * s, 0.14 * s, 0.012 * s);
    g.restore();
    g.strokeStyle = "rgba(36,50,74,.25)"; g.lineWidth = Math.max(0.5, s * 0.003); g.stroke(path);
    g.restore();
  }

  ball(b, color, glow) {
    const c = this.P(b.x, BALL_R, b.z), base = this.P(b.x, 0, b.z);
    if (!c) return;
    const g = this.g, r = BALL_R * c.s;
    g.fillStyle = "rgba(40,30,20,.25)";
    g.beginPath(); g.ellipse(base.x, base.y, r * 0.95, r * 0.3, 0, 0, Math.PI * 2); g.fill();
    if (glow) {
      g.fillStyle = "rgba(255,255,255,.55)";
      g.beginPath(); g.arc(c.x, c.y, r * (1.35 + 0.1 * Math.sin(performance.now() / 120)), 0, Math.PI * 2); g.fill();
    }
    const grad = g.createRadialGradient(c.x - r * 0.35, c.y - r * 0.4, r * 0.1, c.x, c.y, r);
    grad.addColorStop(0, "#ffffff"); grad.addColorStop(0.25, color); grad.addColorStop(1, shade(color, -0.35));
    g.fillStyle = grad; g.beginPath(); g.arc(c.x, c.y, r, 0, Math.PI * 2); g.fill();
    // finger holes rolling over the top
    for (const [ox, ph] of [[-0.22, 0], [0.22, 0], [0, 0.55]]) {
      const a = b.roll + ph;
      const vis = Math.cos(a);
      if (vis <= 0) continue;
      g.fillStyle = "rgba(20,25,40,.55)";
      g.beginPath(); g.ellipse(c.x + ox * r, c.y - Math.sin(a) * r * 0.75, r * 0.1, r * 0.1 * vis, 0, 0, Math.PI * 2); g.fill();
    }
  }
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + v * amt)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
