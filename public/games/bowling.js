// Bowling game module for the laptop.
import { Lane, clamp } from "../physics.js";
import { Renderer } from "../render.js";
import { scoreGame, nextRoll, rollLabel } from "../scoring.js";

export class BowlingGame {
  constructor(ctx) {
    this.ctx = ctx;
    this.lane = new Lane();
    this.renderer = new Renderer(ctx.canvas);
    this.holdingUntil = 0;
    this.aimPreview = null;
    this.over = false;
  }

  get active() { return this.order[this.idx]; }

  start(order) {
    this.order = order;
    this.rolls = { 1: [], 2: [] };
    this.idx = 0;
    this.ballInMotion = this.busy = this.over = false;
    this.lane.ball = null;
    this.lane.resetRack();
    this.renderer.cam.z = -2.4;
    this.renderBoard();
    this.sendTurn();
  }

  turnMsg() {
    const p = this.active, n = nextRoll(this.rolls[p]);
    return { type: "turn", sport: "bowling", player: p, frame: n.frame + 1, ball: n.ball + 1 };
  }

  sendTurn() {
    this.aimPreview = null;
    const p = this.active, m = this.turnMsg();
    this.ctx.send(m);
    this.ctx.ui.banner(`Player ${p} · Frame ${m.frame} — ${this.ctx.connected[p] ? "swing your phone!" : "press Space"}`, p, true);
    this.renderBoard();
  }

  handleThrow(m) {
    if (![m.power, m.spin, m.aim].every(Number.isFinite)) return { accepted: false, reason: "invalid" };
    if (this.over || m.player !== this.active || this.ballInMotion || this.busy) return { accepted: false, reason: "not_your_turn" };
    this.launch(m);
    return { accepted: true };
  }

  onMsg(m) {
    if (m.player !== this.active) return;
    if (m.type === "tilt") this.holdingUntil = performance.now() + 250;
    if (m.type === "aim" && Number.isFinite(m.v)) this.aimPreview = clamp(m.v, -1, 1);
  }

  launch({ power, spin, aim }) {
    this.ballInMotion = true;
    this.ctx.ui.banner(null, null, false);
    this.lane.launch({ power: clamp(power, 0, 1), spin: clamp(spin, -1, 1), aim: clamp(aim, -1, 1) });
  }

  key(e) {
    if (e.code !== "Space" || this.over || this.ballInMotion || this.busy) return;
    e.preventDefault();
    this.launch({ power: 0.55 + Math.random() * 0.4, spin: (Math.random() - 0.5) * 0.9, aim: (Math.random() - 0.5) * 0.8 });
  }

  finishRoll() {
    this.ballInMotion = false;
    this.busy = true;
    const p = this.active;
    const before = nextRoll(this.rolls[p]);
    const knocked = clamp(this.lane.knocked(), 0, before.standing);
    this.rolls[p].push(knocked);
    const label = rollLabel(knocked, before.standing, before.ball);
    this.ctx.ui.pop(label);
    if (label === "STRIKE!") this.ctx.ui.confetti();
    this.ctx.send({ type: "result", pins: knocked, label, total: scoreGame(this.rolls[p]).total, to: p });
    this.renderBoard();

    setTimeout(() => {
      this.lane.ball = null;
      const n = nextRoll(this.rolls[p]);
      if (n.done || n.frame !== before.frame) {
        for (let k = 1; k <= this.order.length; k++) {
          const j = (this.idx + k) % this.order.length;
          if (!nextRoll(this.rolls[this.order[j]]).done) { this.idx = j; break; }
        }
      }
      if (this.order.every((q) => nextRoll(this.rolls[q]).done)) return this.end();
      const nn = nextRoll(this.rolls[this.active]);
      if (nn.standing === 10) this.lane.resetRack(); else this.lane.sweep();
      this.busy = false;
      this.sendTurn();
    }, 1900);
  }

  end() {
    this.over = true;
    this.busy = false;
    const totals = this.order.map((p) => ({ p, value: scoreGame(this.rolls[p]).total }));
    const best = Math.max(...totals.map((t) => t.value));
    this.ctx.ui.gameOver({ totals, winners: totals.filter((t) => t.value === best).map((t) => t.p), unit: "" });
  }

  renderBoard() {
    const C = this.ctx.colors;
    this.ctx.ui.board(this.order.map((p) => {
      const sc = scoreGame(this.rolls[p]);
      const cur = !this.over && p === this.active ? nextRoll(this.rolls[p]).frame : -1;
      const frames = sc.frames.map((f, i) => {
        const slots = i === 9 ? 3 : 2;
        const m = [...f.marks];
        if (i < 9 && m[0] === "X") m.splice(0, 1, "", "X");
        const balls = Array.from({ length: slots }, (_, k) => `<span>${m[k] ?? ""}</span>`).join("");
        return `<div class="frame ${i === 9 ? "tenth" : ""} ${i === cur ? "now" : ""}"><div class="balls">${balls}</div><div class="cum">${f.cum ?? ""}</div></div>`;
      }).join("");
      return `<div class="row ${p === this.active ? "active" : ""}"><div class="chip" style="background:${C[p]}">P${p}</div>${frames}<div class="total">${sc.total}</div></div>`;
    }).join(""));
  }

  frame(dt, now) {
    const lane = this.lane, cam = this.renderer.cam;
    if (this.ballInMotion && !lane.step(dt)) this.finishRoll();
    const b = lane.ball;
    const targetZ = b && !b.inPit ? Math.min(b.z - 2.6, 14.2) : b ? 14.2 : -2.4;
    const k = 1 - Math.exp(-dt * (b ? 6 : 3));
    cam.z += (targetZ - cam.z) * k;
    cam.h += ((b ? 0.95 : 1.35) - cam.h) * k;
    cam.x += ((b && !b.inPit ? b.x * 0.5 : 0) - cam.x) * k;
    this.renderer.draw(lane, {
      idleBall: !this.over && !b,
      ballColor: this.ctx.colors[this.active] || "#5b7cfa",
      glow: now < this.holdingUntil,
      guide: !b && (this.aimPreview != null || now < this.holdingUntil),
      aim: this.aimPreview ?? 0,
      t: now / 1000,
    });
  }
}
