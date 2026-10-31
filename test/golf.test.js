import { test } from "node:test";
import assert from "node:assert/strict";
import { HOLES, Shot, surfaceAt, autoClub, headingTo, dist, scoreName, previewLanding, puttRange } from "../public/golf.js";

const play = (hole, pos, heading, club, swing, lie, wind = { x: 0, y: 0 }) => {
  const s = new Shot(hole, pos, heading, club, swing, lie, wind, () => 0.5);
  for (let i = 0; i < 6000 && s.step(1 / 60); i++);
  return s;
};
const h1 = HOLES[0];

test("every hole: tee is a tee and the pin is on the green", () => {
  for (const h of HOLES) { assert.equal(surfaceAt(h, ...h.tee), "tee"); assert.equal(surfaceAt(h, ...h.pin), "green"); }
});
test("surfaces: water, sand, out of bounds", () => {
  assert.equal(surfaceAt(h1, ...h1.water[0].c), "water");
  assert.equal(surfaceAt(h1, ...h1.sand[0].c), "sand");
  assert.equal(surfaceAt(h1, 500, 0), "oob");
});
test("auto club picks something sensible", () => {
  assert.equal(autoClub(300, "tee"), "driver");
  assert.equal(autoClub(100, "fairway"), "9i");
  assert.equal(autoClub(5, "green"), "putter");
  assert.notEqual(autoClub(300, "fairway"), "driver"); // no driver off the deck
});
test("more backswing = longer shot", () => {
  const head = headingTo(h1.tee, h1.pin);
  const d = [0.5, 0.75, 1].map((p) => dist(h1.tee, play(h1, h1.tee, head, "9i", { power: p, face: 0, speedOk: true }, "tee").pos));
  assert.ok(d[0] < d[1] && d[1] < d[2], d.join(","));
  assert.ok(Math.abs(d[2] - 116) < 6, `full 9 iron ${d[2]}`);
});
test("open face curves right, closed face curves left", () => {
  const r = play(h1, h1.tee, 0, "9i", { power: 0.9, face: 0.8, speedOk: true }, "tee");
  const l = play(h1, h1.tee, 0, "9i", { power: 0.9, face: -0.8, speedOk: true }, "tee");
  assert.ok(r.pos[0] > 10 && l.pos[0] < -10, `${r.pos[0]} ${l.pos[0]}`);
});
test("slow downswing tops the ball", () => {
  const ok = play(h1, h1.tee, 0, "9i", { power: 0.9, face: 0, speedOk: true }, "tee");
  const top = play(h1, h1.tee, 0, "9i", { power: 0.9, face: 0, speedOk: false }, "tee");
  assert.ok(dist(h1.tee, top.pos) < dist(h1.tee, ok.pos) * 0.5);
  assert.equal(top.mishit, "Topped it!");
});
test("hitting into the lake is a water ball with a dry drop", () => {
  const s = play(h1, h1.tee, headingTo(h1.tee, h1.water[0].c), "pw", { power: 0.95, face: 0, speedOk: true }, "tee");
  assert.equal(s.result, "water");
  assert.notEqual(surfaceAt(h1, ...s.dropPos), "water");
});
test("a well-judged putt drops; preview matches the putt", () => {
  for (const D of [2, 5, 9]) {
    const pos = [h1.pin[0], h1.pin[1] - D];
    const pw = D / puttRange(D);
    const s = play(h1, pos, 0, "putter", { power: pw, face: 0, speedOk: true }, "green");
    assert.equal(s.result, "holed", `putt ${D} m`);
    const pv = previewLanding(h1, pos, 0, "putter", pw, "green");
    assert.ok(Math.abs(pv.y - h1.pin[1]) < 0.01);
  }
});
test("putt that is way too hard runs past", () => {
  const pos = [h1.pin[0], h1.pin[1] - 4];
  assert.notEqual(play(h1, pos, 0, "putter", { power: 1.15, face: 0, speedOk: true }, "green").result, "holed");
});
test("score names", () => {
  assert.equal(scoreName(1, 3), "HOLE IN ONE!");
  assert.equal(scoreName(3, 4), "Birdie!");
  assert.equal(scoreName(4, 4), "Par");
  assert.equal(scoreName(7, 4), "+3");
});
