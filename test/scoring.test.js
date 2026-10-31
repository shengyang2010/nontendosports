import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreGame, nextRoll, marks, rollLabel } from "../public/scoring.js";

const total = (r) => scoreGame(r).total;

test("gutter game", () => { assert.equal(total(Array(20).fill(0)), 0); assert.ok(scoreGame(Array(20).fill(0)).done); });
test("all ones", () => assert.equal(total(Array(20).fill(1)), 20));
test("perfect game", () => { const g = scoreGame(Array(12).fill(10)); assert.equal(g.total, 300); assert.ok(g.done); });
test("all spares 5/5 + 5", () => assert.equal(total(Array(21).fill(5)), 150));
test("one strike then 3,4", () => assert.equal(total([10, 3, 4, ...Array(16).fill(0)]), 24));
test("one spare then 3", () => assert.equal(total([6, 4, 3, ...Array(17).fill(0)]), 16));
test("tenth frame open has no bonus ball", () => {
  const r = [...Array(18).fill(0), 3, 4];
  assert.ok(scoreGame(r).done); assert.ok(nextRoll(r).done);
});
test("tenth frame spare gets one bonus", () => {
  const r = [...Array(18).fill(0), 7, 3];
  assert.equal(nextRoll(r).standing, 10); assert.ok(!scoreGame(r).done);
  assert.equal(total([...r, 5]), 15);
});
test("tenth frame strike: X then 7 leaves 3 standing", () => {
  const r = [...Array(18).fill(0), 10, 7];
  assert.deepEqual(nextRoll(r), { done: false, frame: 9, ball: 2, standing: 3 });
  assert.equal(total([...r, 3]), 20);
});
test("cum is null while a bonus is pending", () => {
  const g = scoreGame([10, 3]); assert.equal(g.frames[0].cum, null); assert.equal(g.total, 0);
});
test("nextRoll pins standing mid-frame", () => {
  assert.deepEqual(nextRoll([7]), { done: false, frame: 0, ball: 1, standing: 3 });
  assert.deepEqual(nextRoll([10]), { done: false, frame: 1, ball: 0, standing: 10 });
});
test("marks", () => {
  assert.deepEqual(marks([10], false), ["X"]);
  assert.deepEqual(marks([7, 3], false), ["7", "/"]);
  assert.deepEqual(marks([0, 10], false), ["-", "/"]);
  assert.deepEqual(marks([10, 10, 10], true), ["X", "X", "X"]);
  assert.deepEqual(marks([10, 7, 3], true), ["X", "7", "/"]);
  assert.deepEqual(marks([9, 1, 10], true), ["9", "/", "X"]);
  assert.deepEqual(marks([10, 3, 4], true), ["X", "3", "4"]);
});
test("labels", () => {
  assert.equal(rollLabel(10, 10, 0), "STRIKE!");
  assert.equal(rollLabel(3, 3, 1), "SPARE!");
  assert.equal(rollLabel(0, 10, 0), "Gutter...");
  assert.equal(rollLabel(1, 4, 1), "1 pin");
});
