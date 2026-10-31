import { test } from "node:test";
import assert from "node:assert/strict";
import { Lane } from "../public/physics.js";

const roll = (t, seed = 1) => { const L = new Lane(seed); L.launch(t); let n = 0; while (L.step(1 / 60)) if (++n > 2000) break; return L; };

test("rolls always finish with 0-10 pins", () => {
  for (let s = 1; s < 40; s++) {
    const L = roll({ power: (s % 10) / 10, spin: ((s % 7) - 3) / 3, aim: ((s % 9) - 4) / 4 }, s);
    assert.ok(L.knocked() >= 0 && L.knocked() <= 10);
  }
});
test("hard aim to the side is a gutter ball", () => {
  const L = roll({ power: 0.8, spin: 0, aim: 1 });
  assert.ok(L.ball.inGutter); assert.equal(L.knocked(), 0);
});
test("a good hook into the pocket usually strikes", () => {
  let strikes = 0;
  for (let s = 1; s <= 20; s++) if (roll({ power: 0.9, spin: 0.4, aim: -0.3 }, s).knocked() === 10) strikes++;
  assert.ok(strikes >= 15, `strikes ${strikes}`);
});
test("sweep keeps standing pins for the second ball", () => {
  const L = roll({ power: 0.6, spin: 0, aim: 0.3 });
  const left = 10 - L.knocked();
  L.sweep(); L.ball = null;
  assert.equal(L.standingCount(), left);
});
