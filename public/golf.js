// Golf: course data, surfaces, clubs and ball physics. Pure logic (no DOM) so it runs in Node tests.
// Coordinates in metres. x = right, y = up the course (away from the tee). Heading 0 = +y.

export const CLUBS = [
  { id: "driver", name: "Driver",     carry: 215, roll: 22, peak: 30 },
  { id: "3w",     name: "3 Wood",     carry: 190, roll: 18, peak: 28 },
  { id: "5i",     name: "5 Iron",     carry: 160, roll: 12, peak: 28 },
  { id: "7i",     name: "7 Iron",     carry: 135, roll: 9,  peak: 30 },
  { id: "9i",     name: "9 Iron",     carry: 110, roll: 6,  peak: 32 },
  { id: "pw",     name: "Wedge",      carry: 85,  roll: 4,  peak: 30 },
  { id: "sw",     name: "Sand Wedge", carry: 55,  roll: 2,  peak: 24 },
  { id: "putter", name: "Putter",     carry: 0,   roll: 0,  peak: 0 },
];
export const clubById = (id) => CLUBS.find((c) => c.id === id);

// Shapes: circle {c:[x,y], r}, ellipse {c, rx, ry}, capsule {a:[x,y], b:[x,y], w}, rect {x0,y0,x1,y1}
export const HOLES = [
  {
    name: "Lakeside", par: 3, tee: [0, 0], pin: [8, 142],
    bounds: { x0: -70, y0: -18, x1: 75, y1: 178 },
    fairway: [{ a: [0, 22], b: [6, 118], w: 30 }],
    green: { c: [8, 142], rx: 15, ry: 13 },
    sand: [{ c: [-10, 130], rx: 7, ry: 5 }, { c: [26, 150], rx: 6, ry: 5 }],
    water: [{ c: [-30, 78], rx: 16, ry: 24 }],
  },
  {
    name: "The Dogleg", par: 4, tee: [0, 0], pin: [74, 330],
    bounds: { x0: -70, y0: -18, x1: 140, y1: 365 },
    fairway: [{ a: [0, 25], b: [0, 205], w: 36 }, { a: [0, 205], b: [68, 308], w: 34 }],
    green: { c: [74, 330], rx: 17, ry: 15 },
    sand: [{ c: [26, 218], rx: 10, ry: 7 }, { c: [96, 322], rx: 7, ry: 6 }, { c: [54, 342], rx: 6, ry: 5 }],
    water: [{ c: [-38, 175], rx: 17, ry: 36 }],
  },
  {
    name: "Creek Run", par: 5, tee: [0, 0], pin: [14, 468],
    bounds: { x0: -90, y0: -18, x1: 90, y1: 505 },
    fairway: [{ a: [0, 25], b: [-18, 240], w: 40 }, { a: [-18, 240], b: [10, 448], w: 34 }],
    green: { c: [14, 468], rx: 17, ry: 15 },
    sand: [{ c: [-48, 228], rx: 10, ry: 8 }, { c: [22, 250], rx: 9, ry: 7 }, { c: [-6, 452], rx: 7, ry: 5 }, { c: [36, 478], rx: 6, ry: 5 }],
    water: [{ x0: -90, y0: 302, x1: 90, y1: 318 }],
  },
];

const inShape = (s, x, y) => {
  if (s.r != null) return (x - s.c[0]) ** 2 + (y - s.c[1]) ** 2 <= s.r ** 2;
  if (s.rx != null) return ((x - s.c[0]) / s.rx) ** 2 + ((y - s.c[1]) / s.ry) ** 2 <= 1;
  if (s.a) {
    const [ax, ay] = s.a, [bx, by] = s.b, dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= (s.w / 2) ** 2;
  }
  return x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1;
};

export function surfaceAt(hole, x, y) {
  const b = hole.bounds;
  if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) return "oob";
  if (hole.water.some((s) => inShape(s, x, y))) return "water";
  if (inShape(hole.green, x, y)) return "green";
  if (hole.sand.some((s) => inShape(s, x, y))) return "sand";
  if (Math.abs(x - hole.tee[0]) < 5 && Math.abs(y - hole.tee[1]) < 4) return "tee";
  if (hole.fairway.some((s) => inShape(s, x, y))) return "fairway";
  return "rough";
}
export { inShape };

export const SURFACE = {
  //        carry multiplier, roll multiplier, rolling deceleration (m/s²), label
  tee:     { carry: 1.0,  roll: 1.0,  decel: 4,   label: "Tee" },
  fairway: { carry: 1.0,  roll: 1.0,  decel: 4,   label: "Fairway" },
  rough:   { carry: 0.82, roll: 0.4,  decel: 11,  label: "Rough" },
  sand:    { carry: 0.6,  roll: 0.05, decel: 30,  label: "Bunker" },
  green:   { carry: 1.0,  roll: 1.3,  decel: 1.4, label: "Green" },
  water:   { carry: 0,    roll: 0,    decel: 99,  label: "Water" },
  oob:     { carry: 0,    roll: 0,    decel: 99,  label: "Out of bounds" },
};

export const CUP_R = 0.22;   // generous capture radius (real cup is 0.054 m)
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const headingTo = (from, to) => Math.atan2(to[0] - from[0], to[1] - from[1]);
const dir = (h) => [Math.sin(h), Math.cos(h)];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// Best club for this distance and lie (like the auto-select in party golf games)
export function autoClub(distance, lie) {
  if (lie === "green") return "putter";
  const m = lie === "sand" ? 0.6 : SURFACE[lie]?.carry ?? 1;
  const usable = CLUBS.filter((c) => c.id !== "putter" && (c.id !== "driver" || lie === "tee"));
  for (let i = usable.length - 1; i >= 0; i--) {
    const c = usable[i];
    if ((c.carry * m + c.roll * 0.5) >= distance * 0.97) return c.id;
  }
  return usable[0].id;
}

// Max putt distance at full backswing scales with how far away the hole is, so short putts stay controllable.
export const puttRange = (d) => clamp(d * 1.6, 5, 32);

// Where the ball would end up for a given power (no face error, no wind). Used for the live target marker.
export function previewLanding(hole, pos, heading, clubId, power, lie) {
  const club = clubById(clubId);
  const d = dir(heading);
  if (clubId === "putter") {
    const r = puttRange(dist(pos, hole.pin)) * power;
    return { x: pos[0] + d[0] * r, y: pos[1] + d[1] * r, putt: true };
  }
  const lieM = lie === "sand" && clubId === "sw" ? 0.9 : SURFACE[lie].carry;
  const carry = club.carry * Math.min(power, 1.1) * lieM;
  return { x: pos[0] + d[0] * carry, y: pos[1] + d[1] * carry };
}

// rng: () => [0,1)
export class Shot {
  // swing: { power 0..~1.3, face -1..1 (+ = curves right), speedOk: bool }
  constructor(hole, pos, heading, clubId, swing, lie, wind, rng = Math.random) {
    this.hole = hole; this.start = [...pos]; this.wind = wind; this.rng = rng;
    this.t = 0; this.pos = [...pos]; this.h = 0; this.done = false; this.result = null; this.holed = false;
    this.phase = "flight";
    const club = clubById(clubId);
    let power = swing.power, face = clamp(swing.face, -1, 1);
    this.mishit = null;
    if (!swing.speedOk) { power *= 0.3; this.mishit = "Topped it!"; }
    if (power > 1) face += (rng() - 0.5) * (power - 1) * 3;  // overswing = less control
    if (lie === "rough") face += (rng() - 0.5) * 0.25;
    if (lie === "sand" && clubId !== "sw") face += (rng() - 0.5) * 0.4;

    if (clubId === "putter") {
      const range = puttRange(dist(pos, hole.pin)) * clamp(power, 0, 1.15);
      const h = heading + face * 0.05;
      const dec = lie === "green" ? SURFACE.green.decel : SURFACE[lie].decel;
      this.phase = "roll";
      this.vel = dir(h).map((v) => v * Math.sqrt(2 * dec * range));
      return;
    }

    const lieM = lie === "sand" && clubId === "sw" ? 0.9 : SURFACE[lie].carry;
    let carry = club.carry * clamp(power, 0, 1.1) * lieM * (1 + (rng() - 0.5) * 0.04);
    const T = 1.2 + carry / 55;                         // flight time (s)
    const h0 = heading + face * 0.07;                   // start line
    const fwd = dir(h0), side = [fwd[1], -fwd[0]];      // side = to the right
    const windAlong = wind.x * fwd[0] + wind.y * fwd[1];
    const windCross = wind.x * side[0] + wind.y * side[1];
    carry = Math.max(0, carry + windAlong * T * 1.2);
    const curve = face * 0.13 * carry + windCross * T * 1.1; // lateral metres at landing

    this.T = T; this.carry = carry; this.curve = curve; this.fwd = fwd; this.side = side;
    this.peak = club.peak * clamp(carry / 180, 0.25, 1.2);
    this.rollDist = club.roll * clamp(power, 0, 1);
  }

  flightPoint(u) {
    const s = this.carry * u, l = this.curve * u * u;
    return [this.start[0] + this.fwd[0] * s + this.side[0] * l, this.start[1] + this.fwd[1] * s + this.side[1] * l];
  }

  step(dt) {
    if (this.done) return false;
    this.t += dt;
    if (this.phase === "flight") {
      const u = Math.min(1, this.t / this.T);
      this.pos = this.flightPoint(u);
      this.h = 4 * this.peak * u * (1 - u);
      if (u >= 1) this.land();
    } else if (this.phase === "roll") {
      this.roll(dt);
    }
    return !this.done;
  }

  land() {
    this.h = 0;
    const surf = surfaceAt(this.hole, ...this.pos);
    if (surf === "water" || surf === "oob") return this.finish(surf);
    if (dist(this.pos, this.hole.pin) < CUP_R * 1.5) { this.holed = true; this.pos = [...this.hole.pin]; return this.finish("holed"); }
    // direction of travel at landing (tangent of the curved path)
    const a = this.flightPoint(0.98), b = this.flightPoint(1);
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const r = this.rollDist * SURFACE[surf].roll;
    const v = Math.sqrt(2 * SURFACE[surf].decel * r);
    this.vel = [d[0] * v, d[1] * v];
    this.phase = "roll";
  }

  roll(dt) {
    const surf = surfaceAt(this.hole, ...this.pos);
    if (surf === "water" || surf === "oob") return this.finish(surf);
    const sp = Math.hypot(...this.vel);
    // Cup: ball drops if it passes close enough and isn't going too fast
    const dc = dist(this.pos, this.hole.pin);
    if (dc < CUP_R && sp < 1.8) { this.holed = true; this.pos = [...this.hole.pin]; return this.finish("holed"); }
    if (sp < 0.05) return this.finish(surf);
    const ns = Math.max(0, sp - SURFACE[surf].decel * dt);
    this.vel = this.vel.map((v) => (v * ns) / sp);
    this.pos = [this.pos[0] + this.vel[0] * dt, this.pos[1] + this.vel[1] * dt];
  }

  finish(where) {
    this.done = true;
    this.phase = "done";
    this.result = where; // holed | water | oob | tee/fairway/rough/sand/green
    if (where === "water") this.dropPos = this.findDrop();
  }

  // Penalty drop: last dry point along the shot, stepped back a couple of metres
  findDrop() {
    const back = [this.start[0] - this.pos[0], this.start[1] - this.pos[1]];
    const L = Math.hypot(...back) || 1;
    for (let k = 2; k < L; k += 1) {
      const p = [this.pos[0] + (back[0] / L) * k, this.pos[1] + (back[1] / L) * k];
      const s = surfaceAt(this.hole, ...p);
      if (s !== "water" && s !== "oob") return [p[0] + (back[0] / L) * 2, p[1] + (back[1] / L) * 2];
    }
    return [...this.start];
  }
}

export function scoreName(strokes, par) {
  if (strokes === 1) return "HOLE IN ONE!";
  const d = strokes - par;
  return { "-3": "Albatross!", "-2": "Eagle!", "-1": "Birdie!", 0: "Par", 1: "Bogey", 2: "Double bogey" }[d] ?? `+${d}`;
}
