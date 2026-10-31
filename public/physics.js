// Top-down 2D bowling physics. x = across the lane (metres, 0 = centre, +x = right),
// z = down the lane (0 = foul line). Pure logic, no DOM, so it runs in Node tests too.

export const LANE = {
  halfWidth: 0.527,      // regulation lane is 1.054 m wide
  length: 18.29,         // foul line to head pin
  gutter: 0.12,          // gutter width each side
  pitZ: 19.7,            // ball/pins past this drop into the pit
  oilEnd: 12.0,          // ball skids on oil, hooks after this
};
export const BALL_R = 0.109, PIN_R = 0.061;
const BALL_M = 7, PIN_M = 1.5;
const SPACING = 0.3048;

export function rackPositions() {
  const pos = [];
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i <= row; i++) {
      pos.push({ x: (i - row / 2) * SPACING, z: LANE.length + row * SPACING * 0.866 });
    }
  }
  return pos; // pin 1 (head pin) first
}

// Small seeded RNG so tests are repeatable.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export class Lane {
  constructor(seed = Date.now()) {
    this.rand = rng(seed);
    this.pins = rackPositions().map((p, i) => ({
      id: i, x: p.x, z: p.z, vx: 0, vz: 0, home: { ...p },
      standing: true, fallen: false, gone: false, fallDir: 0, fallT: 0,
    }));
    this.ball = null;
  }

  resetRack() {
    for (const p of this.pins) {
      Object.assign(p, { x: p.home.x, z: p.home.z, vx: 0, vz: 0, standing: true, fallen: false, gone: false, fallT: 0, pitT: null });
    }
  }

  // Remove knocked-down pins (the sweep after a first ball).
  sweep() {
    for (const p of this.pins) if (p.fallen) { p.gone = true; p.pitT = null; }
    for (const p of this.pins) if (!p.gone) { p.vx = p.vz = 0; }
  }

  standingCount() { return this.pins.filter((p) => !p.fallen && !p.gone).length; }

  // power 0..1, spin -1..1 (+ curves right), aim -1..1 (+ = right)
  launch({ power, spin, aim }) {
    const speed = 4 + 5 * clamp(power, 0, 1);            // 4–9 m/s
    const angle = clamp(aim, -1, 1) * 0.03;              // radians
    this.ball = {
      x: 0, z: 0.3, vx: speed * Math.sin(angle), vz: speed * Math.cos(angle),
      spin: clamp(spin, -1, 1), roll: 0, inGutter: false, inPit: false,
    };
    this.time = 0;
    this.hitTime = null;
    this.startStanding = this.standingCount();
  }

  // Advance by dt seconds (internally sub-stepped). Returns true while the roll is still going.
  step(dt) {
    const n = Math.ceil(dt / (1 / 240));
    for (let i = 0; i < n; i++) this._step(dt / n);
    return !this.finished();
  }

  _step(dt) {
    const b = this.ball;
    this.time += dt;
    if (b && !b.inPit) {
      // Hook on the dry back end
      if (!b.inGutter && b.z > LANE.oilEnd) b.vx += b.spin * 0.9 * dt;
      b.vz = Math.max(0, b.vz - 0.08 * dt);
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      b.roll += (Math.hypot(b.vx, b.vz) / BALL_R) * dt;

      if (!b.inGutter && Math.abs(b.x) > LANE.halfWidth && b.z < LANE.length - 0.2) {
        b.inGutter = true;
        b.vx = 0;
        b.x = Math.sign(b.x) * (LANE.halfWidth + LANE.gutter / 2);
      }
      if (b.z > LANE.pitZ) b.inPit = true;
      if (!b.inGutter) for (const p of this.pins) if (!p.gone) this._collide(b, BALL_R, BALL_M, p);
    }

    // Pins slide, collide with each other, fall over
    const live = this.pins.filter((p) => !p.gone);
    for (const p of live) {
      const sp = Math.hypot(p.vx, p.vz);
      if (sp > 0) {
        const ns = Math.max(0, sp - 3.5 * dt);
        p.vx *= ns / sp; p.vz *= ns / sp;
        p.x += p.vx * dt; p.z += p.vz * dt;
      }
      if (!p.fallen && (sp > 0.7 || Math.hypot(p.x - p.home.x, p.z - p.home.z) > 0.09)) {
        p.fallen = true;
        p.fallDir = Math.atan2(p.vx, p.vz);
        this.hitTime ??= this.time;
      }
      if (p.fallen) p.fallT = Math.min(1, p.fallT + dt * 4);
      const wallX = LANE.halfWidth + LANE.gutter;
      if (Math.abs(p.x) > wallX) {
        if (p.z > LANE.length - 1.2) { p.x = Math.sign(p.x) * wallX; p.vx *= -0.55; p.fallen = true; } // kickback plate
        else { p.fallen = true; p.gone = true; }
      }
      if (p.z > LANE.pitZ && !p.gone) { p.fallen = true; p.gone = true; p.pitT = this.time; }
    }
    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++) this._collide(live[i], PIN_R, PIN_M, live[j], PIN_M);
  }

  _collide(a, ra, ma, p, mp = PIN_M) {
    // A fallen pin lying down is longer, so it sweeps a wider area
    const rp = p.fallen ? PIN_R * 1.6 : PIN_R;
    const raa = a.fallen ? ra * 1.6 : ra;
    const dx = p.x - a.x, dz = p.z - a.z;
    const d = Math.hypot(dx, dz), min = raa + rp;
    if (d >= min || d === 0) return;
    const nx = dx / d, nz = dz / d;
    // separate
    const push = (min - d) / 2;
    a.x -= nx * push; a.z -= nz * push; p.x += nx * push; p.z += nz * push;
    const rel = (a.vx - p.vx) * nx + (a.vz - p.vz) * nz;
    if (rel <= 0) return;
    const e = 0.7;
    const j = ((1 + e) * rel) / (1 / ma + 1 / mp);
    a.vx -= (j / ma) * nx; a.vz -= (j / ma) * nz;
    // pins scatter a little unpredictably, like real pin action
    const jitter = (this.rand() - 0.5) * 0.5;
    p.vx += (j / mp) * (nx + jitter * nz); p.vz += (j / mp) * (nz - jitter * nx);
  }

  finished() {
    const b = this.ball;
    if (!b) return true;
    if (this.time > 12) return true;
    const ballDone = b.inPit || b.vz < 0.05;
    const pinsQuiet = this.pins.every((p) => p.gone || Math.hypot(p.vx, p.vz) < 0.03);
    const settle = this.hitTime == null ? 0.3 : 1.2;
    if (!ballDone || !pinsQuiet) { this._quietSince = null; return false; }
    this._quietSince ??= this.time;
    return this.time - this._quietSince > settle;
  }

  knocked() { return this.startStanding - this.standingCount(); }
}

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
